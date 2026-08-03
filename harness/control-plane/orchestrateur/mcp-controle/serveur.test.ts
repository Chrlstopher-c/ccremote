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
    emetteur: { envoyer: async () => ({ detail: 'transmis' }), interrompre: async () => {} },
    arreteur: { arreter: async () => {} },
    relanceur: { relancer: async () => ({ dejaVivant: false }) },
    budget: { definir: async () => {} },
    utilisationParc: { comptesConnus: () => [], releves: () => [] },
    configPlafondParc: {},
    // H-61 : sans registre de propositions, `creer_equipe` refuse — la
    // proposition ne survivrait pas au tour et personne ne pourrait l'autoriser.
    propositions: { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) },
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
  //   les six outils de RAPPEL — il ne pouvait réagir qu'à un message de Chris
  //     ou à la fin d'une équipe. Aucun moyen de dire « refais ça dans 10 min » :
  //     il n'a pas d'horloge, et sa session ne tourne même pas entre deux tours.
  // ☠ Et non 13/14 : `permissions_en_attente` et `repondre_permission` sont
  // partis avec le bus d'escalade le 2026-07-31 — aucune demande ne l'a jamais
  // atteint, le classifieur du lead tranche seul (H-40). Ce test est le garde-fou
  // de la surface : un outil qui réapparaît sans décision doit le faire échouer.
  //   `nommer_fil` (2026-08-01) — le titre restait « Nouvelle conversation »
  //     jusqu'à ce que Chris le change à la main, donc en pratique jamais : une
  //     liste de fils tous homonymes. L'outil porte SA propre garde — une seule
  //     fois par session, sauf demande explicite de Chris (`titre-fil.ts`).
  //   `suivre_equipes` (2026-08-01, au PLURIEL) — constat d'usage de Chris :
  //     l'orchestrateur se posait des RAPPELS toutes les 5 à 30 min pour aller
  //     regarder ses équipes une par une. Le rappel n'était pas un contournement
  //     mais un comblement : `suivre_equipe` ne prend qu'une équipe, donc trois
  //     équipes en vol coûtaient trois appels et trois allers-retours de
  //     contexte. Le budget de lignes y est RÉPARTI, jamais multiplié — quatre
  //     transcrits entiers satureraient le contexte qu'on cherche à préserver.
  //   `retirer_mandat` (2026-08-03) — l'orchestrateur pouvait proposer un mandat,
  //     jamais le reprendre. Un mandat remplacé restait autorisable : celui du
  //     02/08 au soir a été autorisé le lendemain matin, sur le mauvais projet,
  //     et a fait échouer le test qu'il devait porter.
  test('expose exactement les 23 outils spécifiés — ni plus, ni moins', () => {
    const noms = construireOutilsControle(deps).map((o) => o.name);
    expect(noms.sort()).toEqual(
      [
        'retirer_mandat',
        'lister_equipes',
        'etat_equipe',
        'rapport_equipe',
        'suivre_equipe',
        'suivre_equipes',
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
        'programmer_rappel',
        'mes_rappels',
        'mettre_rappel_en_pause',
        'reprendre_rappel',
        'modifier_rappel',
        'supprimer_rappel',
        'nommer_fil',
      ].sort(),
    );
  });

  // ☠ Les outils de PROJET sont conditionnels : absents si la composition n'a
  // pas câblé leur port. C'est voulu (mieux vaut un outil invisible qu'un outil
  // qui rend du vide) — mais ça veut dire que le compte ci-dessus ne les couvre
  // PAS, et qu'un port oublié à l'assemblage ne ferait échouer aucun test. D'où
  // les deux tests suivants : ils vérifient l'apparition, pas l'existence.
  test('rechercher_projets apparaît dès que le chercheur est câblé', () => {
    const avec = construireOutilsControle({
      ...deps,
      chercheurProjets: { rechercherProjets: async () => ({ motif: 'x', chemin: '/', occurrences: [] }) },
    }).map((o) => o.name);
    expect(avec).toContain('rechercher_projets');
  });

  test('et reste ABSENT quand il ne l’est pas — jamais un outil qui rend du vide', () => {
    // Un `rechercher_projets` exposé sans port rendrait « aucune occurrence »
    // sur tout, et l'orchestrateur conclurait que le code cherché n'existe pas.
    expect(construireOutilsControle(deps).map((o) => o.name)).not.toContain('rechercher_projets');
  });

  test('☠ H-57 (FAIT AUTORITÉ) — arret_urgence n’est JAMAIS un outil de l’orchestrateur', () => {
    const noms = construireOutilsControle(deps).map((o) => o.name);
    expect(noms).not.toContain('arret_urgence');
  });

  test('(c) readOnlyHint est posé sur tout le groupe inspection', () => {
    const inspection = ['lister_equipes', 'etat_equipe', 'rapport_equipe', 'suivre_equipe', 'suivre_equipes', 'mon_autonomie', 'carburant_parc', 'lister_projets', 'historique_equipe'];
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
