/**
 * Responsabilité : assembler et démarrer LA session orchestrateur (A.1, A.4.2 —
 * mission M-41). Point d'entrée unique : `demarrerOrchestrateur`.
 *
 * `☠ CASSE` CORRIGÉ (banc réel `acceptation/orchestrateur-reel.ts`, 2026-07-22) —
 * la version précédente attendait le message `system`/`init` avant de rendre la
 * main (`tirerMessageInit`). Mesuré sur le vrai SDK 0.3.217 : **`init` n'est émis
 * qu'APRÈS un premier message utilisateur.** L'orchestrateur démarre sur un flux
 * silencieux par conception (H-62 : Chris n'a pas encore parlé au boot du Pi) —
 * personne ne peut envoyer ce premier message tant que `demarrerOrchestrateur`
 * n'a pas rendu la main, puisque c'est cet appel qui donne la poignée
 * (`entree.envoyerOperateur`) permettant d'envoyer quoi que ce soit. Attendre
 * `init` avant de retourner était donc un interblocage STRUCTUREL, pas un
 * timeout mal calibré — `startWorker` (M-01) n'y est pas exposé parce qu'il
 * passe toujours un prompt initial non vide.
 *
 * Correction retenue : **ne jamais attendre `init`, ni aucun message, pour
 * rendre la main.** `demarrerChaud()`/`WarmQuery.query()` ne consomment aucun
 * message — un pré-chauffage réel + un appel `.query()` suffisent à obtenir un
 * `Query` utilisable immédiatement (envoi possible, `getContextUsage()`
 * appelable : ce sont des requêtes de contrôle indépendantes de la lecture du
 * flux). Le message `init`, quand il arrive, est observé par qui lit
 * effectivement `poignee.query` — PAS par ce module : `demarrerOrchestrateur`
 * ne consomme JAMAIS `query` lui-même. Un `AsyncGenerator` n'a qu'un seul
 * consommateur possible (`GenerateurEntree.#reclamerIterateur` lève déjà sur ce
 * principe côté entrée, A.1.3) ; en avoir un second ici volerait au hasard des
 * messages au véritable lecteur (UI, banc d'essai) — bug distinct, également
 * corrigé par cette réécriture (l'ancienne `boucleMessages` en tâche de fond
 * était ce second consommateur illégitime).
 *
 * Conséquence sur la discipline de contexte (A.1.4) : comme ce module ne lit
 * plus le flux, `ingererMessageContexte` (compaction observée côté message) ne
 * peut plus être appelé ICI. La poignée expose `ingererMessage()` : c'est au
 * SEUL lecteur réel de `poignee.query` de l'appeler par message lu — documenté
 * sur `PoigneeOrchestrateur.ingererMessage`. Les hooks `PreCompact`/`PostCompact`
 * (l'autre source, côté SDK) restent branchés dès la composition des `Options`
 * et ne dépendent d'aucune lecture de flux.
 *
 * Séquence retenue (aucune étape n'attend un message de la session) :
 *  1. résoudre l'identité fixe (`identite.ts`) — froid ou reprise ;
 *  2. composer les `Options` (hooks de contexte inclus) ;
 *  3. pré-chauffer (`startup()`, acceptation (c)) puis obtenir le `Query` ;
 *  4. poser la source différée + démarrer l'échantillonnage de contexte ;
 *  5. réconcilier le registre contre le PC (`reconcilier(..., 'demarrage')`,
 *     A.4.2) — ne dépend d'aucun champ de la session orchestrateur ;
 *  6. rendre la poignée. Aucun `await` d'ici ne porte sur un message du `Query`.
 */

import { startup as sdkStartup } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig, Options, Query, SDKMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
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
  /**
   * Flux SDK — À CONSOMMER PAR UN SEUL LECTEUR (le vrai chemin : UI/banc). Ce
   * module ne le lit jamais lui-même (voir en-tête). Un second `for await`
   * ailleurs sur ce même `Query` volerait des messages au premier.
   */
  readonly query: Query;
  /** À appeler par le lecteur de `query`, pour CHAQUE message lu (A.1.4). Ne lève jamais. */
  ingererMessage(message: SDKMessage): void;
  /** Fermeture propre (A.1.2) : clôt le flux d'entrée légitimement, arrête la sentinelle, ferme le process SDK. */
  fermer(): void;
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

/**
 * Étape 3 : pré-chauffage (acceptation (c)) puis obtention du `Query`. N'attend
 * ET NE LIT AUCUN message — `chaud.query()` retourne l'itérateur, il ne le
 * consomme pas.
 */
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

export async function demarrerOrchestrateur(deps: DependancesDemarrageOrchestrateur): Promise<PoigneeOrchestrateur> {
  const journal = deps.journal ?? journalDefaut;
  const { sessionId, entree, sentinelle, source, options } = await assembler(deps, journal);

  const query = await demarrerSessionChaude(deps.demarrerChaud ?? sdkStartup, options, entree);
  journal.info({ sessionId, resume: options.resume !== undefined }, 'session orchestrateur établie (init non attendu — voir en-tête)');

  source.query = query;
  sentinelle.demarrer();

  await reconcilierAuDemarrage(deps, journal);

  return {
    sessionId,
    entree,
    sentinelle,
    query,
    ingererMessage(message: SDKMessage): void {
      ingererMessageContexte(sentinelle, message);
    },
    fermer(): void {
      entree.fermer();
      sentinelle.arreter();
      query.close();
    },
  };
}
