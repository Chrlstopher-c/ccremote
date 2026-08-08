/**
 * Tests d'assemblage du serveur MCP de contrôle (A.2). Vérifie la surface
 * complète : annotations `readOnlyHint`, contrat de retour, et l'absence
 * délibérée de `arret_urgence` (H-57).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { construireOutilsControle, protege, type DependancesServeurControle } from './serveur.ts';
import { MANDAT_ORCHESTRATEUR } from '../processus/mandat.ts';
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
  //   `demander_rallonge_autonomie` (migration 27) — l'orchestrateur pouvait
  //     CONSULTER son plafond (`mon_autonomie`), jamais en demander plus : arrivé
  //     au mur, sa seule option restait d'attendre le prochain clic de Chris sur
  //     un mandat, sans pouvoir seulement dire pourquoi il en faudrait davantage.
  //   `demander_fenetre_autonomie`, `ajuster_autonomie`, `terminer_autonomie`
  //     (2026-08-08) — la fenêtre d'autonomie ne se posait QU'À LA MAIN dans
  //     l'interface. L'orchestrateur pouvait la consulter et demander un plafond,
  //     jamais proposer une plage, la resserrer ni la fermer : Chris devait tout
  //     faire lui-même, y compris fermer une plage dont le chantier était fini.
  //     `☠` Les deux régimes ne sont pas symétriques, et c'est le cœur de la
  //     chose : resserrer et terminer partent seuls, ouvrir et prolonger passent
  //     par un clic — une fenêtre est exactement ce qui dispense l'orchestrateur
  //     de demander l'autorisation, il ne peut donc pas se l'accorder.
  test('expose exactement les 27 outils spécifiés — ni plus, ni moins', () => {
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
        'demander_rallonge_autonomie',
        'demander_fenetre_autonomie',
        'ajuster_autonomie',
        'terminer_autonomie',
      ].sort(),
    );
  });

  // ☠ TROIS OCCURRENCES DU MÊME DÉFAUT, dont une payée en production. Un outil
  // servi par ce serveur mais ABSENT de `MANDAT_ORCHESTRATEUR` n'existe pas pour
  // le modèle : il ne lit pas ce dépôt, ce mandat est sa seule carte.
  //   `repondre_permission` (31/07) — cité alors qu'il avait été supprimé.
  //   `WebSearch`/`WebFetch` (31/07) — promis par le mandat, absents de `tools`.
  //   `demander_rallonge_autonomie` (07/08) — livré le 06/08, jamais annoncé.
  //     Mesuré : l'orchestrateur a écrit à Chris que « l'outil de rallonge
  //     n'apparaît pas dans ma session » et lui a demandé d'aller vérifier la
  //     liste des outils exposés — à quelqu'un qui ne lit pas de code.
  // Ce test ferme la boucle : les deux listes changent ensemble, ou le build casse.
  // ☠ TOUS les ports optionnels sont câblés ici, et c'est le cœur du test : les
  // outils conditionnels sont précisément ceux qu'on oublie d'annoncer, puisqu'ils
  // n'apparaissent dans aucune liste par défaut. Les QUATRE outils machine livrés
  // le 06/08 (`etat_machine`, `reveiller_machine`, `etat_service`,
  // `piloter_service`) sont restés absents du mandat pendant tout ce temps —
  // l'orchestrateur ignorait qu'il pouvait réveiller le PC de Chris, une capacité
  // que Chris avait justement demandée. Un port ajouté sans son annonce doit faire
  // échouer ce test, pas passer inaperçu.
  test('☠ chaque outil servi est ANNONCÉ dans le mandat — sinon il n’existe pas pour le modèle', () => {
    const servis = construireOutilsControle({
      ...deps,
      explorateurProjets: { explorerProjets: async () => ({ racine: '/', chemin: '/', entrees: [] }) },
      chercheurProjets: { rechercherProjets: async () => ({ motif: 'x', chemin: '/', occurrences: [] }) },
      lecteurFichier: {
        lireFichier: async () => ({ ok: true, racine: '/', chemin: '/x', contenu: '', octets: 0, tronque: false }),
      },
      lecteurMetriquesHote: { metriquesHote: async () => null },
      emetteurReveilPc: { reveiller: async () => {} },
      lecteurServiceSysteme: { etatService: async () => null },
      piloteServiceSysteme: { redemarrer: async () => ({ ok: false, motif: 'autre', detail: 'ok' }) },
      compacteurContexte: { demander: () => ({ arme: true, detail: 'ok' }) },
    }).map((o) => o.name);
    expect(servis.filter((nom) => !MANDAT_ORCHESTRATEUR.includes(nom))).toEqual([]);
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

  // ☠ Même famille que `rechercher_projets` ci-dessus : `etat_machine` et
  // `reveiller_machine` sont conditionnels à leur port, absents par défaut ici,
  // ce qui explique pourquoi ils ne figurent pas dans le compte des 23 outils.
  test('etat_machine apparaît dès que le lecteur de métriques est câblé', () => {
    const avec = construireOutilsControle({
      ...deps,
      lecteurMetriquesHote: { metriquesHote: async () => null },
    }).map((o) => o.name);
    expect(avec).toContain('etat_machine');
  });

  test('etat_machine reste ABSENT quand il ne l’est pas', () => {
    expect(construireOutilsControle(deps).map((o) => o.name)).not.toContain('etat_machine');
  });

  test('reveiller_machine apparaît dès que l’émetteur de réveil est câblé', () => {
    const avec = construireOutilsControle({
      ...deps,
      emetteurReveilPc: { reveiller: async () => {} },
    }).map((o) => o.name);
    expect(avec).toContain('reveiller_machine');
  });

  test('reveiller_machine reste ABSENT quand il ne l’est pas', () => {
    expect(construireOutilsControle(deps).map((o) => o.name)).not.toContain('reveiller_machine');
  });

  test('etat_machine porte readOnlyHint (auto-approuvable, comme carburant_parc)', () => {
    const outils = construireOutilsControle({
      ...deps,
      lecteurMetriquesHote: { metriquesHote: async () => null },
    });
    const outil = outils.find((o) => o.name === 'etat_machine');
    expect(outil?.annotations?.readOnlyHint).toBe(true);
  });

  test('reveiller_machine ne porte PAS readOnlyHint (ce n’est pas une lecture)', () => {
    const outils = construireOutilsControle({
      ...deps,
      emetteurReveilPc: { reveiller: async () => {} },
    });
    const outil = outils.find((o) => o.name === 'reveiller_machine');
    expect(outil?.annotations?.readOnlyHint).not.toBe(true);
  });

  // ☠ Même famille que `etat_machine`/`reveiller_machine` ci-dessus : conditionnels
  // à leur port respectif, absents par défaut — donc hors du compte des 23 outils.
  test('etat_service apparaît dès que le lecteur de services est câblé', () => {
    const avec = construireOutilsControle({
      ...deps,
      lecteurServiceSysteme: { etatService: async () => null },
    }).map((o) => o.name);
    expect(avec).toContain('etat_service');
  });

  test('etat_service reste ABSENT quand il ne l’est pas', () => {
    expect(construireOutilsControle(deps).map((o) => o.name)).not.toContain('etat_service');
  });

  test('piloter_service apparaît dès que le piloteur de services est câblé', () => {
    const avec = construireOutilsControle({
      ...deps,
      piloteServiceSysteme: { redemarrer: async () => ({ ok: true }) },
    }).map((o) => o.name);
    expect(avec).toContain('piloter_service');
  });

  test('piloter_service reste ABSENT quand il ne l’est pas', () => {
    expect(construireOutilsControle(deps).map((o) => o.name)).not.toContain('piloter_service');
  });

  test('etat_service porte readOnlyHint (lecture pure)', () => {
    const outils = construireOutilsControle({
      ...deps,
      lecteurServiceSysteme: { etatService: async () => null },
    });
    const outil = outils.find((o) => o.name === 'etat_service');
    expect(outil?.annotations?.readOnlyHint).toBe(true);
  });

  test('piloter_service ne porte PAS readOnlyHint (ce n’est pas une lecture)', () => {
    const outils = construireOutilsControle({
      ...deps,
      piloteServiceSysteme: { redemarrer: async () => ({ ok: true }) },
    });
    const outil = outils.find((o) => o.name === 'piloter_service');
    expect(outil?.annotations?.readOnlyHint).not.toBe(true);
  });

  /**
   * `inputSchema` est la FORME brute passée à `tool()` — un objet de champs
   * Zod (`AnyZodRawShape`), pas un `z.object` complet. Même patron que le test
   * `etat_machine` ci-dessus, cast justifié pour ce seul besoin de test.
   */
  function champZod(
    outils: ReturnType<typeof construireOutilsControle>,
    nom: string,
    champ: string,
  ): { parse: (v: unknown) => unknown } | undefined {
    const outil = outils.find((o) => o.name === nom);
    const schema = outil?.inputSchema as Record<string, { parse: (v: unknown) => unknown }> | undefined;
    return schema?.[champ];
  }

  test('☠ etat_service : un service HORS de la liste blanche est rejeté par Zod', () => {
    const outils = construireOutilsControle({
      ...deps,
      lecteurServiceSysteme: { etatService: async () => null },
    });
    const champService = champZod(outils, 'etat_service', 'service');
    expect(() => champService?.parse('un-service-invente-par-le-modele')).toThrow();
    // Validation dans les deux sens : un service RÉELLEMENT du seau 2/3 passe.
    expect(() => champService?.parse('portfolio')).not.toThrow();
    expect(() => champService?.parse('stockiop-ops-backend')).not.toThrow();
  });

  test('☠ etat_service : le SEAU 1 (jamais exposé) est rejeté par Zod, même par erreur de frappe plausible', () => {
    const outils = construireOutilsControle({
      ...deps,
      lecteurServiceSysteme: { etatService: async () => null },
    });
    const champService = champZod(outils, 'etat_service', 'service');
    expect(() => champService?.parse('ccremote-harness')).toThrow();
    expect(() => champService?.parse('cloudflared')).toThrow();
  });

  test('☠ piloter_service : un service du SEAU 2 (etat_service seulement) est rejeté par Zod', () => {
    const outils = construireOutilsControle({
      ...deps,
      piloteServiceSysteme: { redemarrer: async () => ({ ok: true }) },
    });
    const champService = champZod(outils, 'piloter_service', 'service');
    expect(() => champService?.parse('stockiop-ops-backend')).toThrow();
    expect(() => champService?.parse('homelab-dns')).toThrow();
    // Validation dans les deux sens : un service du seau 3 (les deux outils) passe.
    expect(() => champService?.parse('portfolio')).not.toThrow();
  });

  test('☠ piloter_service : action hors de `restart` est rejetée par Zod (pas de start/stop exposés)', () => {
    const outils = construireOutilsControle({
      ...deps,
      piloteServiceSysteme: { redemarrer: async () => ({ ok: true }) },
    });
    const champAction = champZod(outils, 'piloter_service', 'action');
    expect(() => champAction?.parse('stop')).toThrow();
    expect(() => champAction?.parse('start')).toThrow();
    expect(() => champAction?.parse('restart')).not.toThrow();
  });

  test('etat_service / piloter_service : machine hors du z.enum fermé (« pc ») est rejetée par Zod', () => {
    const outils = construireOutilsControle({
      ...deps,
      lecteurServiceSysteme: { etatService: async () => null },
      piloteServiceSysteme: { redemarrer: async () => ({ ok: true }) },
    });
    expect(() => champZod(outils, 'etat_service', 'machine')?.parse('pc')).toThrow();
    expect(() => champZod(outils, 'etat_service', 'machine')?.parse('pi')).not.toThrow();
    expect(() => champZod(outils, 'piloter_service', 'machine')?.parse('pc')).toThrow();
  });

  test('etat_machine : machine hors du z.enum fermé (« pi ») est refusée par Zod', () => {
    const outils = construireOutilsControle({
      ...deps,
      lecteurMetriquesHote: { metriquesHote: async () => null },
    });
    const outil = outils.find((o) => o.name === 'etat_machine');
    // `inputSchema` est la FORME brute passée à `tool()` — un objet de champs
    // Zod, pas un `z.object` — voir la signature `AnyZodRawShape` du SDK.
    const champMachine = (outil?.inputSchema as { machine: { parse: (v: unknown) => unknown } } | undefined)?.machine;
    expect(champMachine).toBeDefined();
    // `parse` lève sur une valeur hors de l’énumération fermée — c’est la garde
    // structurelle qui empêche un modèle de désigner autre chose que le PC.
    expect(() => champMachine?.parse('pi')).toThrow();
    expect(() => champMachine?.parse('pc')).not.toThrow();
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

  test('☠ etat_service sur une unité absente de systemd (réserve d’inventaire) ⇒ refus propre, jamais une erreur brute', async () => {
    const depsAvecService: DependancesServeurControle = {
      ...deps,
      lecteurServiceSysteme: { etatService: async () => null },
    };
    const outil = trouverOutil(depsAvecService, 'etat_service');
    const resultat = contenuJson(await outil.handler({ machine: 'pi', service: 'portfolio' }, undefined));
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('introuvable');
  });

  test('☠ piloter_service bloqué par l’obstacle sudo ⇒ refus qui nomme la règle manquante, jamais une erreur brute', async () => {
    const depsAvecPilotage: DependancesServeurControle = {
      ...deps,
      piloteServiceSysteme: {
        redemarrer: async () => ({
          ok: false,
          motif: 'permission',
          detail: 'privilège root requis — règle sudoers manquante pour pi',
        }),
      },
    };
    const outil = trouverOutil(depsAvecPilotage, 'piloter_service');
    const resultat = contenuJson(
      await outil.handler({ machine: 'pi', service: 'portfolio', action: 'restart' }, undefined),
    );
    expect(resultat.ok).toBe(false);
    expect(resultat.effet).toBe('refuse');
    expect(resultat.raison).toContain('sudoers');
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
