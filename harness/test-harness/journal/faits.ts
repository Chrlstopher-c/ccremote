// Vocabulaire des faits observables du harness.
// Un test assert sur ces faits, jamais sur des logs ni des délais réels.

export type TypeFait =
  // transport
  | 'lien_coupe_transitoire'
  | 'lien_retabli'
  | 'lien_ferme_terminal'
  | 'remontee_transitoire_orchestrateur'
  | 'octets_perdus'
  | 'integrite_rompue'
  // workers
  | 'worker_spawne'
  | 'worker_mort'
  | 'exit_nu'
  | 'double_worker_worktree'
  | 'worker_rejete_epoch_perime'
  // rattachement
  | 'pi_redemarre'
  | 'inventaire_demande'
  | 'fantome_marque'
  | 'orphelin_adopte'
  | 'orphelin_ignore'
  | 'epoch_incremente'
  | 'reinitialize_appele'
  | 'permission_orpheline'
  // permissions
  | 'permission_recue'
  | 'permission_redelivree'
  | 'permission_dedupliquee'
  | 'notification_emise'
  | 'verdict_reemis'
  | 'permission_caduque'
  | 'null_sans_envoi_horsbande'
  | 'alerte_agent_bloque'
  // observation
  | 'evenement_publie'
  | 'evenement_abandonne'
  | 'producteur_bloque'
  // store
  | 'append_tente'
  | 'append_rejete'
  | 'append_timeout'
  | 'lot_abandonne'
  | 'mirror_error'
  | 'suppression_no_op'
  | 'subkeys_absentes';

export interface Fait {
  readonly a: number;
  readonly type: TypeFait;
  readonly details: Readonly<Record<string, unknown>>;
}
