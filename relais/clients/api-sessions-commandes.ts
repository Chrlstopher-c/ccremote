// Responsabilité : la forme des commandes qu'une route de session envoie au poste. Le relais les transmet après avoir
// vérifié l'identifiant et la session ; il ne décide rien ici.
import type { PieceJointe } from '../../commun/presentation.ts';
import type { AutreSession, EffortSession, ModeSession, ReponseDialogue, SensRelais } from '../../commun/session.ts';

export type CommandeSessionRelais =
  | { kind: 'envoyer'; texte: string; pieces?: PieceJointe[]; auteur?: string; maintenant?: boolean }
  | { kind: 'autonomie'; active: boolean }
  | { kind: 'nuit'; active: boolean; objectif?: string | undefined }
  | { kind: 'remote_control'; actif: boolean }
  | { kind: 'repondre'; reponse: ReponseDialogue }
  | { kind: 'tracer_relais'; sens: SensRelais; autre: AutreSession; texte: string }
  | { kind: 'mode'; mode: ModeSession }
  | { kind: 'modele'; modele: string }
  | { kind: 'effort'; effort: EffortSession | null }
  | { kind: 'rapide'; actif: boolean }
  | { kind: 'ultracode'; actif: boolean }
  | { kind: 'renommer'; titre: string }
  | { kind: 'arreter_tache'; tache: string }
  | { kind: 'mettre_en_fond'; appel: string }
  | { kind: 'interrompre' | 'compacter' | 'fermer' | 'reprendre' };
