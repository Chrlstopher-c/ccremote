/**
 * Tests d'assemblage du processus orchestrateur (A.1, A.4.2). Aucune session
 * réelle : `demarrerChaud` est une doublure, comme `workers/start-worker.test.ts`
 * le fait pour `query` — interdiction explicite de la mission de lancer une
 * vraie session Claude Code.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Options, Query, SDKMessage, SDKSystemMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { creerServeurMcpControle, UTILISATION_PARC_DESACTIVEE, type DependancesServeurControle } from '../mcp-controle/index.ts';
import type { DependancesReconciliation, DescripteurWorkerPc, InventairePc, ReinitialisateurSession, ResultatReinitialisation } from '../../reconciliation/index.ts';
import { demarrerOrchestrateur, DemarrageOrchestrateurError } from './demarrage.ts';
import { JournalIncidentsMemoire } from './incidents.ts';
import type { StockageIdentite, VerificateurSessionExistante } from './identite.ts';

const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function initMessage(): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'oauth',
    claude_code_version: '2.1.217',
    cwd: '/tmp/orchestrateur',
    tools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'],
    mcp_servers: [],
    model: 'claude-opus-4-8',
    permissionMode: 'auto',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: SESSION_ID,
    session_id: SESSION_ID,
    capabilities: [],
  };
}

/** Justification du cast : voir `workers/start-worker.test.ts`, même motif exact. */
function fakeQuery(): Query & { fermetureAppelee: boolean } {
  let ferme = false;
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    yield initMessage();
    await new Promise<void>(() => {}); // simule une session vivante qui ne se termine jamais (A.1.2)
  }
  const generateur = stream();
  const enrichi = generateur as unknown as Query & { fermetureAppelee: boolean };
  Object.defineProperty(enrichi, 'fermetureAppelee', { get: () => ferme });
  (enrichi as unknown as { close: () => void }).close = () => {
    ferme = true;
  };
  (enrichi as unknown as { getContextUsage: () => Promise<unknown> }).getContextUsage = async () => ({
    totalTokens: 0,
    maxTokens: 200_000,
    model: 'claude-opus-4-8',
  });
  return enrichi;
}

function stockageMemoire(initial: string | null): StockageIdentite {
  let valeur = initial;
  return {
    lire: () => valeur,
    ecrire: (id: string) => {
      valeur = id;
    },
  };
}

const VERIFICATEUR_INCONNU: VerificateurSessionExistante = { existe: async () => false };

class InventairePcVide implements InventairePc {
  appels = 0;
  inventaire(): readonly DescripteurWorkerPc[] {
    this.appels += 1;
    return [];
  }
  tuerSansPreavis(): void {}
}

class ReinitialisateurMuet implements ReinitialisateurSession {
  async reinitialiser(): Promise<ResultatReinitialisation> {
    return { demandesEnAttente: [] };
  }
}

let registre: Registre;
let depsServeur: DependancesServeurControle;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  depsServeur = {
    registre,
    repertoireProjets: '/tmp/demarrage-test-inexistant',
    // Désactivation explicite du plafond de parc (H-74), jamais une omission.
    utilisationParc: UTILISATION_PARC_DESACTIVEE,
    configPlafondParc: {},
    cibles: { cible: () => null },
    arreteur: { arreter: async () => {} },
    relanceur: { relancer: async () => {} },
    budget: { definir: async () => {} },
  };
});

afterEach(() => {
  registre.fermer();
});

/**
 * `☠ V2 (migration 22)` — `reconciliation` est un FOURNISSEUR de périmètres, un
 * par machine de travail en ligne, évalué à chaque démarrage. Une valeur figée
 * ignorerait toute machine apparue depuis l'assemblage.
 */
function reconciliationVide(): () => readonly DependancesReconciliation[] {
  return () => [{ inventairePc: new InventairePcVide(), reinitialisateur: new ReinitialisateurMuet() }];
}

describe('demarrerOrchestrateur — ne bloque jamais', () => {
  test('résout la poignée même si la session est « vivante pour toujours » en arrière-plan', async () => {
    const query = fakeQuery();
    const poignee = await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: reconciliationVide(),
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> =>
        ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    expect(poignee.sessionId).toBeTruthy();
    expect(poignee.query).toBe(query);
  });

  test('(c) démarre via startup() — le pré-chauffage sort le spawn du chemin critique', async () => {
    const query = fakeQuery();
    let optionsRecues: Options | undefined;
    await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: reconciliationVide(),
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (params): Promise<WarmQuery> => {
        optionsRecues = params?.options;
        return { query: () => query, close: () => {} } as unknown as WarmQuery;
      },
    });
    expect(optionsRecues?.tools).not.toContain('Bash');
  });

  test('(a) fermer() clôt explicitement le flux d’entrée ET le process SDK', async () => {
    const query = fakeQuery();
    const poignee = await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: reconciliationVide(),
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    poignee.fermer();
    expect(poignee.entree.etat).toBe('ferme');
    expect(query.fermetureAppelee).toBe(true);
  });
});

describe('demarrerOrchestrateur — réconciliation au boot (A.4.2)', () => {
  test('☠ appelle bien reconcilier(..., "demarrage") avant de rendre la main', async () => {
    const inventaire = new InventairePcVide();
    const query = fakeQuery();
    await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: () => [{ inventairePc: inventaire, reinitialisateur: new ReinitialisateurMuet() }],
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    expect(inventaire.appels).toBeGreaterThan(0);
  });

  test('une réconciliation en échec ne bloque PAS la mise en ligne du bras droit (H-62)', async () => {
    const inventaireEnEchec: InventairePc = {
      inventaire: () => {
        throw new Error('PC injoignable');
      },
      tuerSansPreavis: () => {},
    };
    const query = fakeQuery();
    const poignee = await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: () => [{ inventairePc: inventaireEnEchec, reinitialisateur: new ReinitialisateurMuet() }],
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    expect(poignee.sessionId).toBeTruthy();
  });
});

describe('demarrerOrchestrateur — échecs', () => {
  test('pré-chauffage en échec ⇒ DemarrageOrchestrateurError', async () => {
    await expect(
      demarrerOrchestrateur({
        stockageIdentite: stockageMemoire(null),
        verificateurSessionExistante: VERIFICATEUR_INCONNU,
        serveurControle: creerServeurMcpControle(depsServeur),
        registre,
        reconciliation: reconciliationVide(),
        incidents: new JournalIncidentsMemoire(),
        demarrerChaud: async (): Promise<WarmQuery> => {
          throw new Error('process introuvable');
        },
      }),
    ).rejects.toBeInstanceOf(DemarrageOrchestrateurError);
  });
});

describe('demarrerOrchestrateur — ☠ CORRIGÉ : n’attend JAMAIS init (banc réel orchestrateur-reel.ts)', () => {
  /**
   * Reproduit exactement le fait mesuré : le SDK n'émet `init` qu'APRÈS un
   * premier message utilisateur. Un flux qui ne renvoie RIEN — jamais même
   * `init` — doit quand même laisser `demarrerOrchestrateur` rendre la main.
   * Avant le correctif, ce scénario provoquait un `DemarrageOrchestrateurError`
   * après le délai de `tirerMessageInit` (ou pendait, selon le timeout de test).
   */
  function fakeQuerySansAucunMessage(): Query & { close: () => void } {
    async function* stream(): AsyncGenerator<SDKMessage, void> {
      await new Promise<void>(() => {}); // ne renvoie jamais RIEN, pas même init
    }
    const enrichi = stream() as unknown as Query & { close: () => void };
    enrichi.close = () => {};
    (enrichi as unknown as { getContextUsage: () => Promise<unknown> }).getContextUsage = async () => ({
      totalTokens: 0,
      maxTokens: 200_000,
      model: 'claude-opus-4-8',
    });
    return enrichi;
  }

  test('rend la main même si le flux ne produit RIEN, jamais même init — plus d’interblocage', async () => {
    const query = fakeQuerySansAucunMessage();
    const debut = Date.now();
    const poignee = await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: reconciliationVide(),
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    expect(Date.now() - debut).toBeLessThan(5_000);
    expect(poignee.sessionId).toBeTruthy();
    expect(poignee.query).toBe(query);
  });

  test('ne consomme JAMAIS query lui-même — le premier message reste disponible pour le vrai lecteur', async () => {
    const query = fakeQuery(); // yield initMessage() puis reste vivant
    const poignee = await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: reconciliationVide(),
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    // Si demarrerOrchestrateur avait lu le flux en interne (l'ancienne boucleMessages),
    // ce premier next() externe ne verrait JAMAIS le message init — il aurait déjà été volé.
    const { value, done } = await poignee.query.next();
    expect(done).toBe(false);
    expect((value as SDKSystemMessage).subtype).toBe('init');
  });

  test('ingererMessage() est exposé pour que le vrai lecteur alimente la discipline de contexte', async () => {
    const query = fakeQuery();
    const poignee = await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: reconciliationVide(),
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    poignee.ingererMessage({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual', pre_tokens: 500, post_tokens: 100 },
    } as unknown as SDKMessage);
    expect(poignee.sentinelle.resume().dernierEvenementCompaction?.trigger).toBe('manual');
  });
});
