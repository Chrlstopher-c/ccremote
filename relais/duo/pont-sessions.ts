// Responsabilité : ce que le mode duo demande au relais local pour agir au nom du pair (ouvrir, écrire, interrompre).
// Ce sont les fonctions des routes de Chris, jamais un chemin parallèle ; le bilan HTTP est relu en résultat.
import { z } from 'zod';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { ModeSession, Projet } from '../../commun/session.ts';
import { echec, ok, type Resultat } from './resultat.ts';

export interface OuvertureChezProprietaire {
  readonly machine: string;
  readonly projet: Projet;
  readonly message: string;
  readonly modele?: string;
  readonly autonomie: boolean;
  readonly mode: ModeSession;
}

export interface PontSessions {
  ouvrir(demande: OuvertureChezProprietaire): Promise<Response>;
  envoyer(session: string, texte: string, pieces: readonly PieceJointe[], auteur: string): Promise<Response>;
  interrompre(session: string): Promise<Response>;
}

const CorpsErreur = z.object({ erreur: z.string() });
const CorpsSession = z.object({ id: z.string() });

export async function bilan(reponse: Response): Promise<Resultat<unknown>> {
  const corps: unknown = await reponse.json();
  if (reponse.ok) return ok(corps);
  const erreur = CorpsErreur.safeParse(corps);
  return echec(reponse.status, erreur.success ? erreur.data.erreur : `refus ${reponse.status}`);
}

export function identifiantSession(corps: unknown): string | null {
  const r = CorpsSession.safeParse(corps);
  return r.success ? r.data.id : null;
}
