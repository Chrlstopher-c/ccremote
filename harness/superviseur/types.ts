/**
 * Responsabilité : formes de données du superviseur de workers, côté PC (branche B,
 * D.3 — mission M-13).
 *
 * Ce module est le CORPS des ports déclarés comme contrats par d'autres missions :
 * `InventairePc` / `ReinitialisateurSession` (`control-plane/reconciliation/types.ts`,
 * M-30) et `RepertoireCibles` / `ArreteurMission` / `RelanceurMission`
 * (`control-plane/orchestrateur/mcp-controle/types.ts`, A.2). Il ne les redéfinit
 * jamais — il les importe et les implémente à la lettre (scope_guard).
 *
 * ☠ Frontière A↔B inexistante (03-couche-1.md) : ce module ignore tout du registre
 * SQLite du Pi (E.1). Il ne connaît que ce qu'on lui donne au démarrage d'un worker
 * (`DemandeDemarrage`) et ce qu'il observe lui-même (résultats de tour). Toute
 * decision qui a besoin du registre passe par un port injecté, jamais un import direct.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { GenerateurEntree } from '../control-plane/orchestrateur/entree/index.ts';
import type { WorkerHandle, WorkerSpec } from '../workers/index.ts';
import type { WorkerSpecPersistee } from './persistance-registre.ts';
import type { DecisionRelance } from '../relance/types.ts';

export type { FileEntreeCiblee } from '../pause/index.ts';
export type { ObservateurUsage } from '../budgets/index.ts';

/** Ce que le Pi fournit en plus du `WorkerSpec` au moment du dispatch (D.2.3, D.3.1). */
/**
 * Ce qui traverse RÉELLEMENT le lien pour démarrer une équipe.
 *
 * `☠` Un `WorkerSpec` complet n'est PAS transportable : il porte des ports
 * (`portAuditPermissions`, `portBusPermissions`) et des fonctions de spawn, qui
 * ne survivent pas à une sérialisation JSON. Les envoyer produirait côté PC un
 * worker sans audit ni bus de permissions — soit un agent qui passe tous les
 * contrôles en ne protégeant rien (H-73.1, H-74). Le Pi n'envoie donc que des
 * données, et le PC réassemble le spec avec SES ports locaux.
 */
export interface ParametresSpecTransportables {
  readonly sessionId: string;
  readonly cwd: string;
  readonly mandate: string;
  readonly deniedToolPatterns: readonly string[];
  readonly maxBudgetUsd: number;
  readonly model?: string;
  /** Niveau de raisonnement du lead (posé via `Options.settings`). */
  readonly effortLevel?: 'low' | 'medium' | 'high' | 'xhigh';
  readonly configDir?: string;
  readonly agentTeams?: boolean;
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/** Forme transportable de `DemandeDemarrage` (voir ci-dessus). */
export interface DemandeDemarrageTransportable {
  readonly missionId: string;
  readonly epoch: number;
  readonly promptInitial: string;
  readonly parametres: ParametresSpecTransportables;
}

export interface DemandeDemarrage {
  readonly missionId: string;
  /** Epoch attribué par le Pi à ce rattachement (D.2.3) — stocké, pas arbitré ici (M-11). */
  readonly epoch: number;
  readonly spec: WorkerSpec;
  /**
   * Premier message utilisateur, mis en file avant le spawn (piège H-60 : un flux
   * silencieux n'émet jamais `init`). Jamais vide.
   */
  readonly promptInitial: string;
}

/**
 * Émis à chaque décision de la politique de relance (B.3, wiring M-13). Best-effort
 * (H-15) : la remontée réelle vers le Pi passe par le canal d'observation (E.2, hors
 * périmètre) — ce port n'ouvre aucune connexion, il notifie un appelant déjà présent
 * en mémoire du même process. Conforme à D.3.2 : le PC ne pousse rien lui-même.
 */
export interface ObservateurRelance {
  surDecision(missionId: string, decision: DecisionRelance): void;
}

/**
 * Port du client d'observabilité temps réel (E.2, mission M-50) — même motif
 * que `ObservateurRelance`/`ObservateurUsage` : best-effort (H-15), aucune
 * connexion ouverte, un simple callback vers un consommateur déjà en mémoire.
 * Implémenté par `RegistreObservationParc` (`control-plane/observabilite/`),
 * jamais réimporté ici pour garder ce module ignorant du registre du Pi
 * (frontière A↔B, `03-couche-1.md`).
 *
 * `☠` N'appelle JAMAIS `getContextUsage()` ni aucun appel de contrôle depuis
 * l'intérieur de `ingererMessageFlux` — piège mesuré H-72.3 : entrelacé avec
 * la lecture du flux, ça fait perdre les messages des sous-agents. Ce port ne
 * reçoit que des messages déjà lus par l'unique consommateur du `Query`.
 */
export interface ObservateurFlux {
  ingererMessageFlux(missionId: string, message: SDKMessage): void;
}

/** Enregistrement interne d'un worker vivant ou récemment mort (survit à la mort pour permettre la relance). */
export interface EnregistrementWorker {
  readonly missionId: string;
  readonly sessionId: string;
  readonly epoch: number;
  readonly worktree: string;
  readonly spec: WorkerSpec;
  readonly handle: WorkerHandle;
  /**
   * Concret, pas la seule forme `FileEntreeCiblee` : `arreter()` a besoin de
   * `.fermer()` (A.1.2) en plus de `.envoyerMessage()` (A.2.2, `cible()`).
   */
  readonly entree: GenerateurEntree;
  vivant: boolean;
  /**
   * Pid OS du process réel (persistance, dette n°1 — TODO.md). `null`/absent tant
   * qu'aucune voie de capture n'existe : `WorkerHandle` (workers/types.ts, hors
   * périmètre de ce dossier) n'expose actuellement AUCUN pid pour le spawn local
   * intégré du SDK (`SpawnedProcess` ne le déclare pas non plus, cf. sdk.d.ts). Champ
   * posé dès maintenant pour que la persistance et la revalidation soient prêtes le
   * jour où `workers/` l'alimente (ex. via un `spawnProcess` custom, B.2.1) — à
   * répercuter, hors périmètre de cette mission (`superviseur/` seul modifiable ici).
   */
  readonly pid?: number | null;
  /** Starttime `/proc/<pid>/stat` au moment de l'enregistrement — voir `pid`. */
  readonly pidStarttime?: string | null;
}

// ---------------------------------------------------------------------------
// Persistance et restauration du registre (dette n°1, TODO.md).
// ---------------------------------------------------------------------------

/** Trois issues distinctes de la revalidation d'un pid restauré. Jamais deux confondues. */
export type EtatRevalidationProcess = 'vivant_confirme' | 'mort_confirme' | 'indetermine';

/** Ligne relue depuis la persistance disque (`persistance-registre.ts`). */
export interface LigneRegistrePersistee {
  readonly sessionId: string;
  readonly missionId: string;
  readonly worktree: string;
  readonly epoch: number;
  readonly pid: number | null;
  readonly pidStarttime: string | null;
  /**
   * Identité du boot Linux au moment de l'écriture (H-75, dette n°1 après un
   * redémarrage de la machine). `null` pour toute ligne écrite avant cette
   * évolution (migration 2, `persistance-registre.ts`) — à traiter comme
   * « illisible » ⇒ `indetermine`, jamais comme un boot différent.
   */
  readonly bootId: string | null;
  readonly vivant: boolean;
  /**
   * `☠` **Pas un `WorkerSpec` complet** : les ports (`portAuditPermissions`,
   * `portBusPermissions`, `sessionStore`, `spawnProcess`, `onStderr`) sont des
   * fonctions, effacées sans bruit par la sérialisation JSON. Relancer un worker
   * depuis cette spec sans réinjecter les ports donnerait un worker **sans audit
   * ni arbitrage de permissions** — des garde-fous éteints par le simple fait
   * d'un redémarrage (H-74). Les ports sont réinjectés par la composition.
   */
  readonly spec: WorkerSpecPersistee;
  readonly majA: number;
}

/**
 * Concurrent reconstruit par `restauration-registre.ts` au démarrage. Ne possède
 * AUCUN handle réel : le process qu'il représente, s'il existe encore, n'est pas
 * contrôlé par cette instance du superviseur — c'est précisément le problème que
 * la dette n°1 corrige (le fencing doit le voir, sans pouvoir prétendre le piloter).
 */
export interface ConcurrentRestaure {
  readonly sessionId: string;
  readonly missionId: string;
  readonly worktree: string;
  readonly epoch: number;
  readonly pid: number | null;
  readonly pidStarttime: string | null;
  /**
   * `☠` Spec **relue du disque**, donc amputée de ses ports (voir
   * `LigneRegistrePersistee.spec`). C'est cohérent avec ce qu'est un concurrent
   * restauré : un process que cette instance **ne pilote pas**. Si un jour on
   * voulait le relancer, il faudrait réinjecter les ports par la composition —
   * jamais réutiliser cette spec telle quelle.
   */
  readonly spec: WorkerSpecPersistee;
  readonly etat: EtatRevalidationProcess;
  /** `☠` Biais asymétrique non négociable : `indetermine` ⇒ `true` (jamais de libération dans le doute). */
  vivant: boolean;
}

// ---------------------------------------------------------------------------
// Arrêt d'urgence (G.4, mission M-52) — formes de données.
//
// `☠` Distinct de la PAUSE GLOBALE (M-33, `pause/`) : H-57 tranche que ce sont
// deux gestes séparés. Ici, chaque étape est un fait observable pour l'audit,
// jamais une supposition — un rapport qui ne liste QUE 'forcage' dit que la
// pause et la fermeture propre ont échoué mais que le filet a quand même agi.
// ---------------------------------------------------------------------------

/** Étape réellement exécutée pour UNE mission, dans l'ordre de tentative (jamais l'ordre de succès). */
export type EtapeArretUrgence = 'pause_globale' | 'fermeture_propre' | 'forcage';

/** Résultat d'un arrêt d'urgence appliqué à UNE mission (utilisé aussi par le banc de drill récurrent, G.4.3). */
export interface ResultatArretUnitaireUrgence {
  readonly missionId: string;
  readonly sessionId: string;
  readonly etapes: readonly EtapeArretUrgence[];
}

/** Rapport agrégé d'un arrêt d'urgence déclenché sur tout le parc vivant du PC (G.4.2). */
export interface RapportArretUrgence {
  readonly declencheA: number;
  readonly missions: readonly ResultatArretUnitaireUrgence[];
}

/**
 * Ce que le PC observe d'un worker vivant et que le Pi ne peut pas deviner.
 *
 * `☠` Le PC est la SEULE autorité sur ces valeurs (B.1.4) : elles viennent du
 * flux SDK, qui n'existe que là. Sans ce transport, l'interface affichait un
 * coût à 0, un contexte à 0 et un fil vide sur des équipes qui travaillaient
 * réellement — des chiffres faux valent moins que des champs absents.
 *
 * `☠` Cumulatif, jamais différentiel : le Pi peut manquer des relevés (réseau
 * coupé, service redémarré). Un delta perdu fausserait le total pour toujours,
 * alors qu'une valeur absolue se resynchronise au relevé suivant.
 */
/**
 * Un poste de la ventilation du contexte. `☠` `differe` (`isDeferred` côté SDK)
 * signale un poste ANNONCÉ mais PAS chargé : mesuré, les postes différés
 * (~36 K d'outils MCP et système) ne sont PAS comptés dans `totalTokens`. Les
 * additionner ferait dépasser le total réel de plus du double.
 */
export interface PosteContexte {
  readonly nom: string;
  readonly tokens: number;
  readonly differe: boolean;
}

export interface TelemetrieWorker {
  readonly missionId: string;
  readonly sessionId: string;
  readonly vivant: boolean;
  /** Modèle réellement résolu par le CLI, lu au message `init`. */
  readonly modeleResolu: string | null;
  readonly etatSdk: 'idle' | 'running' | 'requires_action' | null;
  /** Coût cumulé en dollars depuis le démarrage. */
  readonly coutUsd: number;
  readonly contexteTokensUtilises: number | null;
  readonly contexteTokensMax: number | null;
  /**
   * Ventilation du contexte par poste, telle que le SDK la rend.
   *
   * `☠` MESURÉ le 23/07 : `totalTokens` seul rend la jauge illisible. Sur une
   * mission à « 10 % », ~24 K sont du socle incompressible (prompt système,
   * outils, CLAUDE.md, skills) présent dès le premier token, et ~79 K sont du
   * travail réel. Sans la ventilation, ces deux natures sont indiscernables —
   * et c'est justement la distinction sur laquelle on décide d'un atterrissage.
   */
  readonly contexteVentilation: readonly PosteContexte[] | null;
  /** Dernier texte de l'assistant, tronqué court — de quoi voir que ça avance (H-45). */
  readonly derniereActivite: string | null;
  /**
   * Textes produits depuis le dernier relevé, en attente d'entrer au fil de la
   * mission. `☠` Le relevé est DRAINANT : ces entrées ne seront pas rendues deux
   * fois. C'est ce qui permet à l'opérateur de lire ce que son équipe a écrit —
   * sans quoi il n'a « que les états et compteurs » (23/07).
   */
  readonly activitesEnAttente: readonly { readonly texte: string; readonly survenuA: number }[];
  /** Le compte de ce worker a annoncé une limite atteinte — il faut tourner. */
  readonly quotaSature: boolean;
  readonly motifQuota: string | null;
  readonly observeA: number;
}
