/**
 * Responsabilité : assembler et démarrer LA session orchestrateur (A.1, A.4.2 —
 * mission M-41). Point d'entrée unique : `demarrerOrchestrateur`.
 *
 * Séquence imposée (A.1.2 + A.4.2) :
 *  1. résoudre l'identité fixe (`identite.ts`) — froid ou reprise ;
 *  2. composer les `Options` structurelles (`options-orchestrateur.ts`), en y
 *     accrochant les hooks de discipline de contexte AVANT le spawn (ils sont
 *     lus une seule fois à la composition) ;
 *  3. pré-chauffer via `startup()` du SDK (acceptation (c)) — sort le coût de
 *     spawn du chemin critique, PUIS envoyer le flux d'entrée déjà construit ;
 *  4. tirer le message `init`, démarrer l'échantillonnage de contexte ;
 *  5. réconcilier le registre contre le PC (`reconcilier(..., 'demarrage')`,
 *     A.4.2) — AVANT d'entrer en boucle de lecture, jamais après : un incident
 *     survenu pendant la fenêtre de démarrage ne doit pas attendre un tour de
 *     conversation pour être détecté ;
 *  6. boucler sur les messages, en tâche de fond (l'appelant récupère la
 *     poignée immédiatement — acceptation (a), invariant « ne bloque jamais »).
 *
 * `☠ CASSE` évité : la réconciliation (étape 5) ne dépend d'AUCUN champ de la
 * session orchestrateur elle-même — elle continue de s'exécuter même si le
 * `Query` de l'orchestrateur est dégradé. Les deux sont volontairement
 * découplés (03-couche-1.md, frontière A↔B inexistante : la réconciliation
 * appartient à E/D, pas à la conversation de l'orchestrateur).
 */

import { startup as sdkStartup } from '@anthropic-ai/claude-agent-sdk';
import type {
  McpServerConfig,
  Options,
  Query,
  SDKMessage,
  SDKSystemMessage,
  WarmQuery,
} from '@anthropic-ai/claude-agent-sdk';
import type { Registre } from '../../registre/index.ts';
import { reconcilier, type DependancesReconciliation } from '../../reconciliation/index.ts';
import { SentinelleContexte } from '../../../discipline-contexte/index.ts';
import { resoudreIdentite, type StockageIdentite, type VerificateurSessionExistante } from './identite.ts';
import { composerOptionsOrchestrateur } from './options-orchestrateur.ts';
import { creerHooksContexte, ingererMessageContexte, SourceContexteDifferee } from './contexte-integration.ts';
import { EntreeOrchestrateur } from './entree-orchestrateur.ts';
import { construireAlarmeFermetureImprevue } from './alarme-fermeture-imprevue.ts';
import type { JournalIncidentsOrchestrateur } from './incidents.ts';
import { processusOrchestrateurLogger as journalDefaut } from './logger.ts';

export type DemarrerChaudFn = typeof sdkStartup;

export interface DependancesDemarrageOrchestrateur {
  readonly stockageIdentite: StockageIdentite;
  readonly verificateurSessionExistante: VerificateurSessionExistante;
  readonly serveurControle: McpServerConfig;
  readonly nomServeurControle?: string;
  readonly registre: Registre;
  readonly reconciliation: DependancesReconciliation;
  readonly incidents: JournalIncidentsOrchestrateur;
  readonly cwd?: string;
  readonly configDir?: string;
  /** Injectable : `startup()` réel par défaut, une doublure en test (jamais de session réelle). */
  readonly demarrerChaud?: DemarrerChaudFn;
  readonly journal?: typeof journalDefaut;
  readonly initTimeoutMs?: number;
}

export class DemarrageOrchestrateurError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemarrageOrchestrateurError';
  }
}

export interface PoigneeOrchestrateur {
  readonly sessionId: string;
  readonly entree: EntreeOrchestrateur;
  readonly sentinelle: SentinelleContexte;
  readonly query: Query;
  /** Fermeture propre (A.1.2) : clôt le flux d'entrée légitimement, puis le process SDK. */
  fermer(): void;
}

const TIMEOUT_INIT_PAR_DEFAUT_MS = 60_000;

function estMessageInit(message: SDKMessage): message is SDKSystemMessage {
  return message.type === 'system' && message.subtype === 'init';
}

async function tirerMessageInit(query: Query, timeoutMs: number): Promise<SDKSystemMessage> {
  const echeance = Date.now() + timeoutMs;
  for (;;) {
    const restant = echeance - Date.now();
    if (restant <= 0) break;
    const suivant = await Promise.race([
      query.next(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), restant)),
    ]);
    if (suivant === 'timeout') break;
    if (suivant.done === true) {
      throw new DemarrageOrchestrateurError("flux orchestrateur terminé avant le message init");
    }
    if (estMessageInit(suivant.value)) return suivant.value;
  }
  throw new DemarrageOrchestrateurError(`aucun message init reçu sous ${timeoutMs} ms`);
}

/**
 * Boucle de fond (étape 6). Jamais attendue par `demarrerOrchestrateur` : elle
 * tourne tant que la session vit, et n'est jamais elle-même le chemin par
 * lequel une erreur remonte à l'appelant (acceptation « ne bloque jamais »).
 */
async function boucleMessages(query: Query, sentinelle: SentinelleContexte, journal: typeof journalDefaut): Promise<void> {
  try {
    for await (const message of query) {
      ingererMessageContexte(sentinelle, message);
    }
  } catch (erreur) {
    journal.error({ err: erreur }, 'boucle de messages orchestrateur interrompue par une exception');
  } finally {
    sentinelle.arreter();
  }
}

async function reconcilierAuDemarrage(deps: DependancesDemarrageOrchestrateur, journal: typeof journalDefaut): Promise<void> {
  try {
    const rapport = await reconcilier(deps.registre, deps.reconciliation, 'demarrage');
    journal.info({ rapport }, 'réconciliation de démarrage terminée (A.4.2)');
  } catch (erreur) {
    // `☠` Ne bloque jamais la mise en ligne du bras droit (H-62) — mais une
    // réconciliation en échec au boot est en soi une alarme : loggée `error`,
    // jamais absorbée en silence. Rattrapable par un balayage périodique.
    journal.error({ err: erreur }, 'réconciliation de démarrage EN ÉCHEC — équipes fantômes/orphelines possibles jusqu’au prochain passage');
  }
}

interface AssemblageDemarrage {
  readonly sessionId: string;
  readonly entree: EntreeOrchestrateur;
  readonly sentinelle: SentinelleContexte;
  readonly source: SourceContexteDifferee;
  readonly options: Options;
}

/** Étapes 1-2 : identité + entrée (avec l'alarme H-60 déjà branchée) + options. */
async function assembler(deps: DependancesDemarrageOrchestrateur, journal: typeof journalDefaut): Promise<AssemblageDemarrage> {
  const decision = await resoudreIdentite(deps.stockageIdentite, deps.verificateurSessionExistante);
  const source = new SourceContexteDifferee();
  const sentinelle = new SentinelleContexte(source);

  const entree = new EntreeOrchestrateur({
    sessionId: decision.sessionId,
    surFermetureImprevue: construireAlarmeFermetureImprevue({
      sessionId: decision.sessionId,
      incidents: deps.incidents,
      journal,
      redemarrer: (delaiMs) => {
        journal.warn({ delaiMs }, 'redémarrage automatique demandé — orchestration réelle hors périmètre de ce module (superviseur du process)');
      },
    }),
  });

  const options = composerOptionsOrchestrateur({
    decision,
    serveurControle: deps.serveurControle,
    nomServeurControle: deps.nomServeurControle,
    hooksContexte: creerHooksContexte(sentinelle),
    cwd: deps.cwd,
    configDir: deps.configDir,
  });

  return { sessionId: decision.sessionId, entree, sentinelle, source, options };
}

/** Étape 3 : pré-chauffage (acceptation (c)) puis envoi du flux d'entrée déjà construit. */
async function demarrerSessionChaude(
  demarrerChaud: DemarrerChaudFn,
  options: Options,
  entree: EntreeOrchestrateur,
): Promise<Query> {
  let chaud: WarmQuery;
  try {
    chaud = await demarrerChaud({ options });
  } catch (erreur) {
    throw new DemarrageOrchestrateurError(`pré-chauffage impossible : ${String(erreur)}`);
  }
  try {
    return chaud.query(entree.flux);
  } catch (erreur) {
    throw new DemarrageOrchestrateurError(`spawn impossible après pré-chauffage : ${String(erreur)}`);
  }
}

export async function demarrerOrchestrateur(deps: DependancesDemarrageOrchestrateur): Promise<PoigneeOrchestrateur> {
  const journal = deps.journal ?? journalDefaut;
  const { sessionId, entree, sentinelle, source, options } = await assembler(deps, journal);

  const query = await demarrerSessionChaude(deps.demarrerChaud ?? sdkStartup, options, entree);
  const init = await tirerMessageInit(query, deps.initTimeoutMs ?? TIMEOUT_INIT_PAR_DEFAUT_MS);
  journal.info({ sessionId, mode: options.resume !== undefined ? 'reprise' : 'demarrage_froid', capabilities: init.capabilities }, 'session orchestrateur démarrée');

  source.query = query;
  sentinelle.demarrer();

  await reconcilierAuDemarrage(deps, journal);
  void boucleMessages(query, sentinelle, journal);

  return {
    sessionId,
    entree,
    sentinelle,
    query,
    fermer(): void {
      entree.fermer();
      query.close();
    },
  };
}
