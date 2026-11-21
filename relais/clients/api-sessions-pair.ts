// Responsabilité : écrire et interrompre une session du pair (mode duo) depuis les routes de sessions. La session
// tourne chez le pair ; l'écriture passe le lien s'il l'a partagée en écriture avec nous. Le reste est refusé.
import type { PieceJointe } from '../../commun/presentation.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { erreur, json, REFUS_POSTE } from './http.ts';
import type { Resultat } from '../duo/resultat.ts';

export const TEXTE_REFUS_DUO = 'session partagée par le pair : elle tourne chez lui, la commande se passe là-bas';
export const TEXTE_LECTURE_SEULE = 'session partagée par le pair en lecture seule : écriture non permise';

// Ce que le mode duo offre pour les sessions du pair (écrire, interrompre chez le propriétaire).
export interface PontPair {
  ecrireAPair(
    session: string,
    texte: string,
    pieces: readonly PieceJointe[],
    relayeDe?: { readonly session: string; readonly titre: string },
  ): Promise<Resultat<unknown>>;
  interrompreAPair(session: string): Promise<Resultat<unknown>>;
}

export async function ecrireAuPair(
  pair: PontPair | null,
  session: ResumeSession,
  texte: string,
  pieces: readonly PieceJointe[],
  relayeDe?: { readonly session: string; readonly titre: string },
): Promise<Response> {
  if (session.duo?.niveau !== 'ecriture') return erreur(TEXTE_LECTURE_SEULE, REFUS_POSTE);
  if (!pair) return erreur(TEXTE_REFUS_DUO, REFUS_POSTE);
  return reponseDuo(await pair.ecrireAPair(session.id, texte, pieces, relayeDe));
}

export async function interrompreAuPair(pair: PontPair | null, session: ResumeSession): Promise<Response> {
  if (session.duo?.niveau !== 'ecriture') return erreur(TEXTE_LECTURE_SEULE, REFUS_POSTE);
  if (!pair) return erreur(TEXTE_REFUS_DUO, REFUS_POSTE);
  return reponseDuo(await pair.interrompreAPair(session.id));
}

function reponseDuo(r: Resultat<unknown>): Response {
  return r.ok ? json({}) : erreur(r.raison, r.statut);
}
