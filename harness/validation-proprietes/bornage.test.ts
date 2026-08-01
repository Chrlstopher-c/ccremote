/**
 * M-53 — Propriété 5/5 : BORNAGE (03-couche-1.md, critère de réussite).
 *
 * « Aucune équipe ne peut dépasser son budget sans arrêt automatique. »
 *
 * Assemble trois modules réels de production sur la même chaîne budget → env → relance :
 *  - `buildWorkerEnv` (B.1.3, `workers/options-composition.ts`) — point de composition
 *    RÉEL où `assertRetryWatchdogCoherent` (G.1.4, panne #15) est appelé, pas seulement
 *    documenté ;
 *  - `deciderRelance` (B.3.2/B.3.3, `relance/politique-relance.ts`) — la politique réelle,
 *    avec un VRAI `CompteurRelances` (jamais une doublure du plafond) ;
 *  - `deciderCreationMission` (G.1.3, `budgets/plafond-parc.ts`) — le plafond de parc réel.
 *
 * `☠ CONCLUSION HONNÊTE, PAS À ARRONDIR` — cette propriété n'est TENUE QUE
 * PARTIELLEMENT, et c'est la découverte la plus importante de cette mission :
 *
 *  1. Les bornes MÉCANIQUES ci-dessous existent et sont exercées réellement : le retry
 *     watchdog ne peut pas être activé sans budget actif (test 1), un échec structurel ou
 *     `budget_exhausted` n'est jamais relancé automatiquement (tests 2-3), et même le
 *     groupe relançable (`transitoire`) est plafonné en nombre de tentatives (test 4).
 *  2. MAIS le mécanisme conçu spécifiquement pour arrêter une boucle qui ne déclenche
 *     JAMAIS `max_turns` ni `budget_exhausted` (H-68 : paliers de consommation + juge
 *     Haiku) N'EST PAS IMPLÉMENTÉ. `grep -rl "Haiku\|juge\|palier"` sur le dépôt (hors
 *     `test-harness/`) ne retourne AUCUN module de production — seule une mention en
 *     commentaire dans `budgets/types.ts` : « hors périmètre de ce module ». Une mission
 *     qui boucle sans jamais lever une des deux raisons terminales couvertes n'est bornée
 *     QUE par `maxBudgetUsd` (filet très haut, H-68 : « 12 $ ≈ 6 minutes de Sonnet 5 » — un
 *     filet dimensionné pour ne jamais gêner, donc lent à se déclencher) et par le rate
 *     limit natif du compte (externe au code, non testable ici).
 *  3. Le plafond de PARC (`deciderCreationMission`, G.1.3) existe et est testé (test 5),
 *     mais n'est appelé par AUCUN site de production — `grep -rn deciderCreationMission`
 *     sur `control-plane/` et `superviseur/` ne retourne rien en dehors de son propre
 *     fichier et de son test. Configurer un seuil (`seuilUtilisationPct`) aujourd'hui
 *     n'aurait AUCUN effet observable : rien ne l'appelle avant `creer_equipe`.
 */

import { describe, expect, test } from 'bun:test';
import { buildWorkerEnv } from '../workers/index.ts';
import type { WorkerSpec } from '../workers/index.ts';
import { GardeBudgetError, deciderCreationMission } from '../budgets/index.ts';
import { CompteurRelances, PLAFOND_RELANCES_DEFAUT } from '../relance/compteur-relances.ts';
import { deciderRelance } from '../relance/politique-relance.ts';

function specMinimal(surcharge: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: 'sess-1',
    cwd: '/wt/alpha',
    mandate: 'test bornage',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    mcpServers: {}, portAuditPermissions: () => ({}),
    deniedToolPatterns: [],
    maxBudgetUsd: 40,
    ...surcharge,
  };
}

describe('bornage 1 — assertRetryWatchdogCoherent (G.1.4, panne #15) au point de composition réel', () => {
  test('CLAUDE_CODE_RETRY_WATCHDOG=1 SANS budget actif est refusé par buildWorkerEnv lui-même', () => {
    const spec = specMinimal({ maxBudgetUsd: 0, extraEnv: { CLAUDE_CODE_RETRY_WATCHDOG: '1' } });
    expect(() => buildWorkerEnv(spec)).toThrow(GardeBudgetError);
  });

  test('CLAUDE_CODE_RETRY_WATCHDOG=1 AVEC budget actif (fini, > 0) est autorisé', () => {
    const spec = specMinimal({ maxBudgetUsd: 40, extraEnv: { CLAUDE_CODE_RETRY_WATCHDOG: '1' } });
    expect(() => buildWorkerEnv(spec)).not.toThrow();
  });

  test('sans le retry watchdog, un budget à 0 compose sans lever — la garde ne mord QUE sur le watchdog', () => {
    const spec = specMinimal({ maxBudgetUsd: 0 });
    expect(() => buildWorkerEnv(spec)).not.toThrow();
  });
});

describe('bornage 2 — budget_exhausted (borne prévue) n’est jamais relancé automatiquement (panne #13)', () => {
  test('deciderRelance sur "budget_exhausted" remonte, ne relance jamais, n’incrémente aucune tentative', () => {
    const compteur = new CompteurRelances();
    const decision = deciderRelance('sess-1', 'budget_exhausted', { compteur });
    expect(decision.action).toBe('remonter');
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(0);
  });
});

describe('bornage 3 — un échec structurel n’est jamais relancé, jamais (panne #12)', () => {
  test('deciderRelance sur "prompt_too_long" (structurel) : échec définitif immédiat, sans consommer de tentative', () => {
    const compteur = new CompteurRelances();
    const decision = deciderRelance('sess-1', 'prompt_too_long', { compteur });
    expect(decision.action).toBe('echec_definitif');
    expect(compteur.etat('sess-1').tentativesEffectuees).toBe(0); // jamais compté comme une tentative
  });
});

describe('bornage 4 — même le groupe relançable ("transitoire") est plafonné en nombre de tentatives', () => {
  test(`au-delà de ${PLAFOND_RELANCES_DEFAUT} tentatives, une erreur transitoire cesse d’être relancée`, () => {
    const compteur = new CompteurRelances();
    let derniereDecision;
    for (let i = 0; i < PLAFOND_RELANCES_DEFAUT + 2; i += 1) {
      // `deciderRelance` incrémente lui-même le compteur quand il décide 'relancer'
      // (voir `politique-relance.ts`, groupe 'transitoire') — ne pas le faire deux fois.
      derniereDecision = deciderRelance('sess-1', 'api_error', { compteur });
    }
    // Après avoir épuisé le plafond, la politique doit finir par refuser de relancer
    // indéfiniment une erreur transitoire — sinon panne #12 (boucle non bornée).
    expect(derniereDecision?.action).not.toBe('relancer');
    expect(compteur.etat('sess-1').tentativesEffectuees).toBeLessThanOrEqual(PLAFOND_RELANCES_DEFAUT);
  });
});

describe('bornage 5 — plafond de parc (G.1.3) : existe et coupe les CRÉATIONS, jamais l’existant', () => {
  test('un compte déjà "rejected" sur sa fenêtre refuse toute NOUVELLE mission, même plafond désactivé', () => {
    const decision = deciderCreationMission([{ compteId: 'compte1', typeFenetre: 'five_hour', statut: 'rejected', utilisation: null }], {});
    expect(decision.autorise).toBe(false);
  });

  test('sans seuil configuré (défaut H-58 : désactivé) et sans rejet réel, la création reste autorisée', () => {
    const decision = deciderCreationMission([{ compteId: 'compte1', typeFenetre: 'five_hour', statut: 'allowed', utilisation: 40 }], {});
    expect(decision.autorise).toBe(true);
  });

  test('⚠ défaut réel signalé (hors périmètre M-53, à répercuter) : cette décision n’est appelée par AUCUN site de production', () => {
    // Ce test ne peut pas "échouer" mécaniquement sur une absence de câblage — il
    // documente la vérification faite par grep (voir en-tête) au moment de M-53.
    // Une future mission qui câble deciderCreationMission dans outils-cycle-vie.ts
    // ne casse rien ici ; ce test reste vrai (la fonction continuera d'exister et de
    // décider correctement), il perd seulement sa raison d'être et doit être retiré.
    expect(typeof deciderCreationMission).toBe('function');
  });
});
