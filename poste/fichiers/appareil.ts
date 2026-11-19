// Responsabilité : reconnaître les commandes d'accès à l'appareil (fichiers, terminaux), hors de toute session Claude.
// `fichier_session` (fichier présenté par une session) commence aussi par « fichier » : elle relève des sessions.
import type { CommandeRelais } from '../../commun/protocole-poste.ts';

type KindFichiers = 'fichiers_lister' | 'fichier_lire' | 'fichier_ecrire' | 'fichier_supprimer' | 'fichier_renommer';

export type CommandeAppareil = Extract<CommandeRelais, { kind: KindFichiers | 'dossier_creer' | `terminal_${string}` }>;

export function estAppareil(c: CommandeRelais): c is CommandeAppareil {
  if (c.kind === 'fichier_session') return false;
  return c.kind.startsWith('fichier') || c.kind === 'dossier_creer' || c.kind.startsWith('terminal_');
}
