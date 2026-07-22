/**
 * Responsabilité : point d'entrée public du domaine transport (branche D, M-10).
 */

export type {
  CanalControleProcessus,
  CodeFermeture,
  EtatLien,
  FermetureTerminale,
  Lien,
  ModeIntegrite,
  ProcessusDistant,
  Tuyau,
} from './contrat.ts';
export { ErreurIntegriteTuyau } from './contrat.ts';

export { CanalDonnees, type DepsCanalDonnees } from './canal-donnees.ts';

export {
  ErreurTrameInvalide,
  TAG,
  type TagTrame,
  type TrameDecodee,
  type ExitPayload,
  decoderExit,
  decoderTexte,
  decoderTrame,
  encoderExit,
  encoderTexte,
  encoderTrame,
  versUint8Array,
} from './trame.ts';

export { HORLOGE_REELLE, type AnnulerMinuterie, type HorlogeTransport } from './horloge-transport.ts';

export {
  LienWebSocket,
  type ConnecteurWebSocket,
  type OptionsLienWebSocket,
  type WebSocketLike,
} from './lien-websocket.ts';

export { creerSpawnProcessusDistant, type DepsSpawnProcessusDistant } from './spawn-processus-distant.ts';
