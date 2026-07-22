/**
 * Interface publique du module « audit-permissions » (branche C.5, mission
 * M-22). Aucun autre module ne doit importer les fichiers internes de ce dossier.
 *
 * Périmètre : C.5.1 (ce qui est tracé), C.5.2 (ce que ça permet de répondre),
 * C.1.1 (source d'exhaustivité — `PreToolUse`, jamais `canUseTool`), C.1.2
 * (les trois exceptions), H-40 (validité de l'arbitrage délégué). Le canal
 * hors-bande (C.2.3) et la machine à états des demandes escaladées (M-21)
 * sont hors de ce module.
 */

export { CollecteurAuditPermissions } from './collecteur.ts';
export { creerHooksAuditPermissions, ingererMessageAudit } from './hooks-sdk.ts';
export {
  HORLOGE_REELLE_AUDIT,
  OUTILS_EXCEPTION_C12_CONNUS,
  TRONCATURE_MAX_CARACTERES,
} from './types.ts';
export type {
  AuteurDecision,
  CouvertureAudit,
  DemandeRecurrente,
  EnregistrementAudit,
  FaitEscaladeHumaine,
  FaitExecution,
  FaitRefusHook,
  FaitRefusMessage,
  FaitRefusToolResult,
  FaitTentative,
  HorlogeAudit,
  VerdictAudit,
} from './types.ts';
export { auditPermissionsLogger } from './logger.ts';
