// Responsabilité : le vocabulaire de la salle de réunion (HQ) — une réunion entre sessions principales, ses messages
// et la demande de Chris qui la fait avancer. Les sous-agents n'y figurent jamais : seules les sessions reçoivent.
import { z } from 'zod';

// Auteur d'un message de Chris ; tout autre auteur est l'identifiant d'une session.
export const AUTEUR_CHRIS = 'chris';

// Longueur max de la réponse d'une session recopiée dans la réunion (au-delà, résumée par troncature).
export const LONGUEUR_REPONSE_REUNION = 2000;
export const LONGUEUR_MAX_DEMANDE = 4000;

export const MessageReunion = z.object({
  id: z.string(),
  auteur: z.string(), // AUTEUR_CHRIS ou sessionId
  texte: z.string(),
  ts: z.string(),
  destinataires: z.array(z.string()), // sessionIds visées par ce message (vide pour une réponse de session)
});
export type MessageReunion = z.infer<typeof MessageReunion>;

export const Reunion = z.object({
  id: z.string(),
  sujet: z.string(),
  creeLe: z.string(),
  participants: z.array(z.string()),
  messages: z.array(MessageReunion),
});
export type Reunion = z.infer<typeof Reunion>;

// `auto` : le routage choisit les sessions concernées ; une liste : Chris les a choisies à la main.
export const DemandeReunion = z.object({
  texte: z.string().min(1).max(LONGUEUR_MAX_DEMANDE),
  destinataires: z.union([z.array(z.string().min(1)).min(1), z.literal('auto')]),
  reunionId: z.string().optional(), // absent : nouvelle réunion
});
export type DemandeReunion = z.infer<typeof DemandeReunion>;

export interface EnvoiReunion {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly erreur?: string;
}

export interface ReponseReunion {
  readonly reunion: Reunion;
  readonly envois: readonly EnvoiReunion[];
}
