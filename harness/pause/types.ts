/**
 * Responsabilité : formes de données du domaine « pause et reprise » (B.4, H-46, mission M-33).
 *
 * `☠` Aucune primitive de suspension native (H-46) : une pause se construit à partir
 * d'`interrupt()` + rétention locale de la file d'entrée. Ce module ignore tout du registre
 * (E.1) et du transport (D) — il ne connaît que l'interface minimale dont il a besoin,
 * injectée par l'appelant, dans le même esprit que `StartWorkerDeps` de `workers/`.
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * État vis-à-vis de la pause. Distinct des états harness du registre (E.1.1, panne #30) :
 * ce module ne fait pas autorité sur l'état de l'équipe, il expose le sien à qui l'appelle.
 */
export type EtatPause = 'active' | 'en_pause';

/**
 * Reçu d'interruption normalisé. `degrade: true` couvre deux cas indiscernables pour
 * l'appelant et traités identiquement : capacité `interrupt_receipt_v1` absente de
 * `SDKSystemMessage.capabilities`, ou capacité annoncée mais `interrupt()` ayant quand
 * même résolu `undefined` (CLI antérieur à v2.1.205 mal détecté). Mesuré en réel : le
 * tableau `capabilities` revient souvent **vide** — ce mode n'est pas un cas limite, il
 * faut le concevoir comme le chemin nominal.
 */
export interface RecuInterruption {
  readonly degrade: boolean;
  /** `[]` en mode dégradé. Sinon : liste `still_queued` telle que reçue, jamais réinterprétée. */
  readonly stillQueued: readonly string[];
}

/**
 * Sous-ensemble de `Query` réellement utilisé. Isolé pour l'injection en test — jamais de
 * session réelle en unitaire (règle du dépôt).
 */
export interface SourceInterruption {
  interrupt(): Promise<{ still_queued: string[] } | undefined>;
}

/**
 * Le registre (E.1, hors périmètre de ce module) doit savoir qu'une équipe est en pause
 * **avant** l'interruption effective — sinon une course fait repartir un message en file
 * (mécanique B.4, étape 1). Best-effort assumé côté appelant ; ce module ne connaît pas
 * l'implémentation, seulement ce contrat.
 */
export interface RegistrePauseAdapter {
  marquerEnPause(sessionId: string): void | Promise<void>;
  marquerActive(sessionId: string): void | Promise<void>;
}

/**
 * Cible de retenue de la file d'entrée : sur-ensemble minimal de `GenerateurEntree`
 * (`control-plane/orchestrateur/entree/`), qu'on n'importe pas directement pour ne pas
 * coupler ce module à M-02 — seule la forme utilisée compte ici.
 */
export interface FileEntreeCiblee {
  envoyerMessage(message: SDKUserMessage): Promise<void>;
}

/** Partition d'audit de `still_queued` — jamais une source d'erreur (acceptation c). */
export interface PartitionStillQueued {
  readonly connus: readonly string[];
  readonly inconnus: readonly string[];
}
