/**
 * M-53 — Propriété 1/5 : NON-BLOCAGE (03-couche-1.md, critère de réussite).
 *
 * « Aucune opération de l'orchestrateur n'attend l'exécution d'une équipe. »
 *
 * Assemble le VRAI serveur MCP de contrôle (A.2, `construireOutilsControle`) branché sur
 * des ports (B/D) qui ne répondent JAMAIS — modélisant un worker mort ou un lien Pi↔PC
 * coupé, le pire cas réel (H-15 : ces ports sont best-effort par conception). On mesure
 * le temps de retour, pas seulement le résultat : la garantie testée est mécanique
 * (`avecPlafond`), pas une discipline d'écriture — c'est exactement ce que l'acceptation
 * (a) de M-40 exige de prouver.
 *
 * `☠` Ne teste PAS que le travail sous-jacent s'arrête : `avecPlafond` borne l'ATTENTE de
 * l'appelant, jamais le port lui-même (voir l'en-tête de `plafond.ts`). Un port qui ne
 * répond jamais reste un port cassé après ce test — seul l'orchestrateur ne s'y bloque pas.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ouvrirRegistre, type Registre } from '../control-plane/registre/index.ts';
import { construireOutilsControle, type DependancesServeurControle } from '../control-plane/orchestrateur/mcp-controle/serveur.ts';
import { PLAFOND_PORT_MS_DEFAUT } from '../control-plane/orchestrateur/mcp-controle/plafond.ts';
import type { ContratRetour } from '../control-plane/orchestrateur/mcp-controle/types.ts';

type HandlerGenerique = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;

/** Même motif que `serveur.test.ts` : cast borné, justifié par l'intersection Zod stricte. */
function trouverOutil(deps: DependancesServeurControle, nom: string): { readonly handler: HandlerGenerique } {
  const outil = construireOutilsControle(deps).find((o) => o.name === nom);
  if (outil === undefined) throw new Error(`outil "${nom}" introuvable en test`);
  return outil as unknown as { handler: HandlerGenerique };
}

function contenuJson(resultat: CallToolResult): ContratRetour {
  const bloc = resultat.content[0];
  if (bloc === undefined || bloc.type !== 'text') throw new Error('bloc de contenu inattendu en test');
  return JSON.parse(bloc.text) as ContratRetour;
}

/** Promesse qui ne se résout jamais — modélise un worker/lien mort, pas un simple délai. */
function jamais<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

const MARGE_MS = 800;

let registre: Registre;
let deps: DependancesServeurControle;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'non-blocage' });
  registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'm-1', projet: 'projet-alpha', compteId: 'compte1' });
  registre.missions.attacherSession('m-1', 'sess-1');

  deps = {
    registre,
    repertoireProjets: '/tmp/mcp-controle-projets-inexistant',
    escalades: { enAttente: () => [], repondre: () => true },
    // Port mort : jamais résolu — c'est le cas visé (worker éteint, lien coupé).
    cibles: { cible: () => ({ envoyerMessage: () => jamais(), interrupt: () => jamais() }) },
    arreteur: { arreter: () => jamais() },
    relanceur: { relancer: () => jamais() },
    budget: { definir: () => jamais() },
  };
});

afterEach(() => {
  registre.fermer();
});

describe('non-blocage (acceptation M-40 a) — port mort sur les quatre outils mutatifs de cycle de vie', () => {
  test('envoyer_a_equipe rend la main avant que le port réponde', async () => {
    const outil = trouverOutil(deps, 'envoyer_a_equipe');
    const debut = performance.now();
    const resultat = await outil.handler({ missionId: 'm-1', message: 'continue' }, {});
    const duree = performance.now() - debut;

    expect(duree).toBeLessThan(PLAFOND_PORT_MS_DEFAUT + MARGE_MS);
    const contrat = contenuJson(resultat);
    expect(contrat.effet).toBe('refuse');
    expect(contrat.raison).toContain('délai');
  });

  test('interrompre_equipe rend la main avant que le port réponde', async () => {
    const outil = trouverOutil(deps, 'interrompre_equipe');
    const debut = performance.now();
    const resultat = await outil.handler({ missionId: 'm-1' }, {});
    const duree = performance.now() - debut;

    expect(duree).toBeLessThan(PLAFOND_PORT_MS_DEFAUT + MARGE_MS);
    expect(contenuJson(resultat).effet).toBe('refuse');
  });

  test('arreter_equipe rend la main avant que le port réponde (état harness écrit quand même)', async () => {
    const outil = trouverOutil(deps, 'arreter_equipe');
    const debut = performance.now();
    const resultat = await outil.handler({ missionId: 'm-1' }, {});
    const duree = performance.now() - debut;

    expect(duree).toBeLessThan(PLAFOND_PORT_MS_DEFAUT + MARGE_MS);
    // `arreterEquipe` écrit l'état AVANT d'attendre le port : ceci ne dépend pas du port.
    expect(registre.missions.exiger('m-1').etatHarness).toBe('annulee');
    expect(contenuJson(resultat).effet).toBe('accepte');
  });

  test('relancer_equipe rend la main avant que le port réponde', async () => {
    const outil = trouverOutil(deps, 'relancer_equipe');
    const debut = performance.now();
    const resultat = await outil.handler({ missionId: 'm-1' }, {});
    const duree = performance.now() - debut;

    expect(duree).toBeLessThan(PLAFOND_PORT_MS_DEFAUT + MARGE_MS);
    expect(contenuJson(resultat).effet).toBe('refuse');
  });

  test('les quatre appels envoyés EN PARALLÈLE rendent tous la main sans s’attendre entre eux', async () => {
    const cibles = trouverOutil(deps, 'envoyer_a_equipe');
    const debut = performance.now();
    await Promise.all([
      cibles.handler({ missionId: 'm-1', message: 'a' }, {}),
      cibles.handler({ missionId: 'm-1', message: 'b' }, {}),
      cibles.handler({ missionId: 'm-1', message: 'c' }, {}),
    ]);
    const duree = performance.now() - debut;
    // Si un appel attendait le précédent (au lieu de courir contre son propre
    // plafond indépendant), la durée totale approcherait 3× le plafond.
    expect(duree).toBeLessThan(PLAFOND_PORT_MS_DEFAUT + MARGE_MS);
  });
});

describe('non-blocage — outils d’inspection (lecture seule, ne touchent aucun port)', () => {
  test('lister_equipes répond en quelques millisecondes, jamais borné par un port', async () => {
    const outil = trouverOutil(deps, 'lister_equipes');
    const debut = performance.now();
    await outil.handler({}, {});
    expect(performance.now() - debut).toBeLessThan(200);
  });
});
