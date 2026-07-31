/**
 * Tests d'assemblage du serveur MCP de contrôle (A.2). Vérifie la surface
 * complète : annotations `readOnlyHint`, contrat de retour, et l'absence
 * délibérée de `arret_urgence` (H-57).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { construireOutilsControle, protege, type DependancesServeurControle } from './serveur.ts';
import type { ContratRetour } from './types.ts';

function contenuJson(resultat: CallToolResult): ContratRetour {
  const bloc = resultat.content[0];
  if (bloc === undefined || bloc.type !== 'text') throw new Error('bloc de contenu inattendu en test');
  return JSON.parse(bloc.text) as ContratRetour;
}

type HandlerGenerique = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

/**
 * Le tableau retourné par `construireOutilsControle` mélange des schémas Zod
 * différents par outil ; TypeScript en déduit une intersection stricte des
 * signatures de `handler`. Ce test n'exerce que le contrat de retour uniforme
 * (A.2.3), pas la validation Zod elle-même — cast justifié, pas de `any`.
 */
function trouverOutil(deps: DependancesServeurControle, nom: string): { readonly handler: HandlerGenerique } {
  const outil = construireOutilsControle(deps).find((o) => o.name === nom);
  if (outil === undefined) throw new Error(`outil "${nom}" introuvable en test`);
  return outil as unknown as { handler: HandlerGenerique };
}

let registre: Registre;
let deps: DependancesServeurControle;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'x' });
  deps = {
    registre,
    repertoireProjets: '/tmp/mcp-controle-projets-inexistant',
    cibles: { cible: () => null },
    arreteur: { arreter: async () => {} },
    relanceur: { relancer: async () => {} },
    budget: { definir: async () => {} },
    utilisationParc: { comptesConnus: () => [], releves: () => [] },
    configPlafondParc: {},
    // H-61 : sans registre de propositions, `creer_equipe` refuse — la
    // proposition ne survivrait pas au tour et personne ne pourrait l'autoriser.
    propositions: { enregistrer: () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) },
  };
});

afterEach(() => {
  registre.fermer();
});

describe('surface d’outils (A.2.2)', () => {
  // ☠ 13 depuis le 2026-08-01. Deux ajouts, deux angles morts comblés :
  //   `suivre_equipe` — l'orchestrateur voyait l'ÉTAT d'une équipe et son RAPPORT
  //     de fin, rien entre les deux : aucun moyen de corriger le tir avant la
  //     synthèse, alors qu'`envoyer_a_equipe` existe et n'interrompt rien.
  //   `mon_autonomie` — il ne peut pas DEVINER ce qu'il a le droit de lancer :
  //     la fenêtre vit au registre et son prompt est écrit une fois pour toutes.
  //   `carburant_parc` — l'autonomie était aveugle : quarante équipes lançables
  //     sans jamais savoir qu'on est à 95 % de la fenêtre 5 h. Les données
  //     existaient depuis le 23/07 ; personne ne les consultait.
  // ☠ Et non 13/14 : `permissions_en_attente` et `repondre_permission` sont
  // partis avec le bus d'escalade le 2026-07-31 — aucune demande ne l'a jamais
  // atteint, le classifieur du lead tranche seul (H-40). Ce test est le garde-fou
  // de la surface : un outil qui réapparaît sans décision doit le faire échouer.
  test('expose exactement les 14 outils spécifiés — ni plus, ni moins', () => {
    const noms = construireOutilsControle(deps).map((o) => o.name);
    expect(noms.sort()).toEqual(
      [
        'lister_equipes',
        'etat_equipe',
        'rapport_equipe',
        'suivre_equipe',
        'mon_autonomie',
        'carburant_parc',
        'lister_projets',
        'historique_equipe',
        'creer_equipe',
        'envoyer_a_equipe',
        'interrompre_equipe',
        'arreter_equipe',
        'relancer_equipe',
        'definir_budget',
      ].sort(),
    );
  });

  test('☠ H-57 (FAIT AUTORITÉ) — arret_urgence n’est JAMAIS un outil de l’orchestrateur', () => {
    const noms = construireOutilsControle(deps).map((o) => o.name);
    expect(noms).not.toContain('arret_urgence');
  });

  test('(c) readOnlyHint est posé sur tout le groupe inspection', () => {
    const inspection = ['lister_equipes', 'etat_equipe', 'rapport_equipe', 'suivre_equipe', 'mon_autonomie', 'carburant_parc', 'lister_projets', 'historique_equipe'];
    const outils = construireOutilsControle(deps);
    for (const nom of inspection) {
      const outil = outils.find((o) => o.name === nom);
      expect(outil?.annotations?.readOnlyHint).toBe(true);
    }
  });

  test('les outils mutatifs ne portent pas readOnlyHint: true', () => {
    const outils = construireOutilsControle(deps);
    const mutatif = outils.find((o) => o.name === 'arreter_equipe');
    expect(mutatif?.annotations?.readOnlyHint).not.toBe(true);
  });
});

describe('handlers — contrat uniforme et non-blocage', () => {
  test('lister_equipes retourne le contrat JSON attendu', async () => {
    const outil = trouverOutil(deps, 'lister_equipes');
    const resultat = contenuJson(await outil.handler({}, undefined));
    expect(resultat.ok).toBe(true);
    expect(resultat.effet).toBe('applique');
  });

  test('creer_equipe (H-61) retourne toujours differe, jamais applique', async () => {
    const outil = trouverOutil(deps, 'creer_equipe');
    const resultat = contenuJson(
      await outil.handler({ projet: 'alpha', objectif: 'x', critereArret: null, perimetre: 'src/**' }, undefined),
    );
    expect(resultat.effet).toBe('differe');
  });

  test('envoyer_a_equipe sur équipe introuvable ⇒ refus, jamais d’exception', async () => {
    const outil = trouverOutil(deps, 'envoyer_a_equipe');
    const resultat = contenuJson(await outil.handler({ missionId: 'x', message: 'salut' }, undefined));
    expect(resultat.ok).toBe(false);
  });
});

describe('protege — filet de dernier recours (A.2.4, acceptation d)', () => {
  test('☠ une exception synchrone dans action() ne remonte JAMAIS', async () => {
    const resultat = await protege('outil-test', () => {
      throw new Error('bug imprévu');
    });
    const bloc = resultat.content[0];
    expect(bloc?.type).toBe('text');
    const contrat = JSON.parse((bloc as { text: string }).text) as ContratRetour;
    expect(contrat.ok).toBe(false);
    expect(contrat.raison).toContain('bug imprévu');
  });

  test('une exception asynchrone (rejet de promesse) ne remonte pas non plus', async () => {
    const resultat = await protege('outil-test', async () => {
      throw new Error('rejet async');
    });
    const bloc = resultat.content[0];
    const contrat = JSON.parse((bloc as { text: string }).text) as ContratRetour;
    expect(contrat.ok).toBe(false);
  });
});
