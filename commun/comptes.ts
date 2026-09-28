// Responsabilité : le vocabulaire des comptes Claude Code d'une machine — identité, usage relevé, connexion en cours.
// Partagé par le poste (qui relève), le relais (qui garde la dernière vue) et les clients (qui affichent).
import { z } from 'zod';

export const NOM_COMPTE = /^[a-z0-9][a-z0-9-]{0,30}$/;

// Une fenêtre de quota : part consommée (0–100) et moment de sa remise à zéro.
export const FenetreUsage = z.object({
  libelle: z.string(),
  pourcent: z.number(),
  reinitialiseLe: z.string().nullable(),
});
export type FenetreUsage = z.infer<typeof FenetreUsage>;

export const EtatCompte = z.object({
  id: z.string(), // nom du compte sur cette machine (clé de la config du poste)
  defaut: z.boolean(), // la config Claude Code habituelle de l'utilisateur (~/.claude)
  connecte: z.boolean(),
  email: z.string().nullable(),
  organisation: z.string().nullable(),
  abonnement: z.string().nullable(), // max, pro…
  session: FenetreUsage.nullable(), // fenêtre de 5 h
  semaine: FenetreUsage.nullable(),
  autres: z.array(FenetreUsage), // plafonds hebdomadaires propres à un modèle, etc.
  probleme: z.string().nullable(), // pourquoi l'usage n'a pas pu être relevé
  releveLe: z.string(),
  connexion: z.object({ url: z.string(), depuis: z.string() }).nullable(), // connexion OAuth en cours
});
export type EtatCompte = z.infer<typeof EtatCompte>;
