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
  distant: z.boolean().default(false), // sessions Remote Control de ce compte vues depuis le poste (claude.ai)
  cle: z.string().nullable().default(null), // identité du compte (courriel) : un seul relevé d'usage par compte réel
  usageLe: z.string().nullable().default(null), // quand session/semaine ont été lues pour la dernière fois (relais)
  prochainReleve: z.string().nullable().default(null), // prochain relevé d'usage autorisé par le relais
});
export type EtatCompte = z.infer<typeof EtatCompte>;

// Réponse d'un poste au relais pour un relevé d'usage : l'endpoint `usage` (fenêtres) et l'endpoint `réinitialisations`
// (cedar, brut). `statut` est le pire statut HTTP des deux appels (429 d'abord), `retryApresMs` son Retry-After.
export const FenetresUsage = z.object({
  session: FenetreUsage.nullable(),
  semaine: FenetreUsage.nullable(),
  autres: z.array(FenetreUsage),
});
export type FenetresUsage = z.infer<typeof FenetresUsage>;

// Fenêtre lue dans un `rate_limit_event` du SDK (session de 5 h ou semaine) : la dernière valeur du compte.
export const LimiteSdk = z.object({
  genre: z.enum(['session', 'semaine']),
  fenetre: FenetreUsage,
});
export type LimiteSdk = z.infer<typeof LimiteSdk>;

export const DonneesReleve = z.object({
  fenetres: FenetresUsage.nullable(),
  usage: z.unknown(), // corps brut de l'endpoint d'usage (détail du compte)
  cedar: z.unknown(), // corps brut de l'endpoint des réinitialisations
  statut: z.number().nullable(),
  retryApresMs: z.number().nullable(),
  erreur: z.string().nullable(),
});
export type DonneesReleve = z.infer<typeof DonneesReleve>;
