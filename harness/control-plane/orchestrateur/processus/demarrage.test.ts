/**
 * Tests d'assemblage du processus orchestrateur (A.1, A.4.2). Aucune session
 * réelle : `demarrerChaud` est une doublure, comme `workers/start-worker.test.ts`
 * le fait pour `query` — interdiction explicite de la mission de lancer une
 * vraie session Claude Code.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Options, Query, SDKMessage, SDKSystemMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { creerServeurMcpControle, type DependancesServeurControle } from '../mcp-controle/index.ts';
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
    escalades: { enAttente: () => [], repondre: () => true },
    cibles: { cible: () => null },
    arreteur: { arreter: async () => {} },
    relanceur: { relancer: async () => {} },
    budget: { definir: async () => {} },
  };
});

afterEach(() => {
  registre.fermer();
});

function reconciliationVide(): DependancesReconciliation {
  return { inventairePc: new InventairePcVide(), reinitialisateur: new ReinitialisateurMuet() };
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
  test('☠ appelle bien reconcilier(..., "demarrage") AVANT la boucle de lecture', async () => {
    const inventaire = new InventairePcVide();
    const query = fakeQuery();
    await demarrerOrchestrateur({
      stockageIdentite: stockageMemoire(null),
      verificateurSessionExistante: VERIFICATEUR_INCONNU,
      serveurControle: creerServeurMcpControle(depsServeur),
      registre,
      reconciliation: { inventairePc: inventaire, reinitialisateur: new ReinitialisateurMuet() },
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
      reconciliation: { inventairePc: inventaireEnEchec, reinitialisateur: new ReinitialisateurMuet() },
      incidents: new JournalIncidentsMemoire(),
      demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => query, close: () => {} }) as unknown as WarmQuery,
    });
    expect(poignee.sessionId).toBeTruthy();
  });
});

describe('demarrerOrchestrateur — échecs', () => {
  test('flux terminé avant init ⇒ DemarrageOrchestrateurError', async () => {
    async function* videSansInit(): AsyncGenerator<SDKMessage, void> {}
    const queryVide = videSansInit() as unknown as Query;
    await expect(
      demarrerOrchestrateur({
        stockageIdentite: stockageMemoire(null),
        verificateurSessionExistante: VERIFICATEUR_INCONNU,
        serveurControle: creerServeurMcpControle(depsServeur),
        registre,
        reconciliation: reconciliationVide(),
        incidents: new JournalIncidentsMemoire(),
        demarrerChaud: async (): Promise<WarmQuery> => ({ query: () => queryVide, close: () => {} }) as unknown as WarmQuery,
      }),
    ).rejects.toBeInstanceOf(DemarrageOrchestrateurError);
  });
});
