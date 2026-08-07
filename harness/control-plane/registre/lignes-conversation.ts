/**
 * Responsabilité : la forme SQL d'un fil et de ses événements, et sa traduction
 * vers le domaine. Extrait MÉCANIQUEMENT de `conversations.ts` (même motif que
 * `superviseur/worktree-wiring-workers.ts`) pour tenir la limite de 500 lignes —
 * aucun changement de comportement, le dépôt reste seul à parler à la base.
 *
 * `☠` Les deux mappeurs sont le SEUL endroit qui décide comment une colonne
 * douteuse se lit. Ils retombent tous les deux sur une valeur sûre plutôt que de
 * lever : une ligne écrite par une version antérieure du schéma ne doit pas
 * faire échouer la lecture d'un fil entier.
 */

import {
  lireReglagePlafond,
} from '../autonomie/reglage-plafond.ts';
import type {
  Conversation,
  EvenementConversation,
  PieceJointeMessage,
  TypeEvenementConversation,
} from './types.ts';

export interface LigneConversation {
  id: string;
  titre: string;
  titre_source: string;
  session_id: string | null;
  statut: string;
  cree_a: number;
  maj_a: number;
  compactions: number;
  resume_contexte: string | null;
  modele: string | null;
  effort: string | null;
  machine: string | null;
  autonomie_debut: number | null;
  autonomie_fin: number | null;
  autonomie_objectif: string | null;
  plafond_autonomie: string | null;
}

export interface LigneEvenement {
  seq: number;
  conversation_id: string;
  type: string;
  contenu: string;
  cree_a: number;
  modele: string | null;
  effort: string | null;
  tool_use_id: string | null;
  detail: string | null;
  resultat: string | null;
  pieces: string | null;
}

/**
 * `☠` Une colonne JSON illisible ne doit PAS faire disparaître le message qui la
 * porte : on rend une liste vide et on laisse la trace. Perdre la parole de
 * Chris parce que le descriptif d'une capture est corrompu serait un très
 * mauvais échange.
 */
function lirePieces(brut: string | null): readonly PieceJointeMessage[] {
  if (brut === null || brut.length === 0) return [];
  try {
    const decode: unknown = JSON.parse(brut);
    return Array.isArray(decode) ? (decode as PieceJointeMessage[]) : [];
  } catch {
    return [];
  }
}

export function versConversation(l: LigneConversation): Conversation {
  return {
    id: l.id,
    titre: l.titre,
    // as : colonne alimentée uniquement par `renommer`, dont le paramètre est typé.
    titreSource: l.titre_source as Conversation['titreSource'],
    sessionId: l.session_id,
    // as : colonne sous CHECK IN ('active','archivee').
    statut: l.statut as Conversation['statut'],
    creeA: l.cree_a,
    majA: l.maj_a,
    compactions: l.compactions,
    resumeContexte: l.resume_contexte,
    modele: l.modele,
    effort: l.effort,
    machine: l.machine,
    autonomieDebut: l.autonomie_debut,
    autonomieFin: l.autonomie_fin,
    autonomieObjectif: l.autonomie_objectif,
    plafondAutonomie: lireReglagePlafond(l.plafond_autonomie),
  };
}

export function versEvenement(l: LigneEvenement): EvenementConversation {
  return {
    seq: l.seq,
    conversationId: l.conversation_id,
    // as : colonne sous CHECK IN (…) — aucune autre valeur ne peut exister.
    type: l.type as TypeEvenementConversation,
    contenu: l.contenu,
    creeA: l.cree_a,
    modele: l.modele,
    effort: l.effort,
    toolUseId: l.tool_use_id,
    detail: l.detail,
    resultat: l.resultat,
    pieces: lirePieces(l.pieces),
  };
}
