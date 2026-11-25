// Responsabilité : les formes des modifications d'une session (fichiers touchés, diff, tours), partagées par le
// poste, le relais et les clients. Chemins relatifs au dossier de la session, absolus seulement pour un fichier de
// tour hors de ce dossier.
import { z } from 'zod';

export const PorteeModifications = z.enum(['non_commitees', 'branche']);
export type PorteeModifications = z.infer<typeof PorteeModifications>;

export const EtatFichier = z.enum(['ajoute', 'modifie', 'supprime']);
export type EtatFichier = z.infer<typeof EtatFichier>;

export const FichierModifie = z.object({
  chemin: z.string(),
  etat: EtatFichier,
  ajouts: z.number().int().nonnegative(),
  suppressions: z.number().int().nonnegative(),
  binaire: z.boolean(),
});
export type FichierModifie = z.infer<typeof FichierModifie>;

export const Modifications = z.object({
  racine: z.string(),
  branche: z.string().nullable(),
  fichiers: z.array(FichierModifie),
  // Chemins absolus modifiés par tous les tours de la session (git ou non), pour les totaux du panneau.
  chemins: z.array(z.string()).optional(),
});
export type Modifications = z.infer<typeof Modifications>;

export const GenreLigne = z.enum(['contexte', 'ajout', 'retrait']);
export type GenreLigne = z.infer<typeof GenreLigne>;

export const LigneDiff = z.object({
  genre: GenreLigne,
  ancien: z.number().int().nullable(),
  nouveau: z.number().int().nullable(),
  texte: z.string(),
});
export type LigneDiff = z.infer<typeof LigneDiff>;

export const Hunk = z.object({
  ancienDebut: z.number().int(),
  nouveauDebut: z.number().int(),
  lignes: z.array(LigneDiff),
});
export type Hunk = z.infer<typeof Hunk>;

export const Diff = z.object({
  chemin: z.string(),
  etat: EtatFichier,
  binaire: z.boolean(),
  hunks: z.array(Hunk),
});
export type Diff = z.infer<typeof Diff>;

// Référence d'un tour : `dernier` (le dernier tour enregistré) ou son identifiant.
export const TourRef = z.string().regex(/^(dernier|[A-Za-z0-9-]{1,100})$/);
export const CheminModifie = z.string().min(1).max(1000);

// Refus attendus du panneau Modifications (dossier hors dépôt git, dépôt sans branche de base) : un état, pas une panne.
const MOTIF_REFUS_DEPOT = /hors dépôt git|aucune branche de base/;

/** Vrai pour un refus qui dit seulement que le dossier n'a pas de dépôt git utilisable. */
export function estRefusDepot(erreur: string | null | undefined): boolean {
  return typeof erreur === 'string' && MOTIF_REFUS_DEPOT.test(erreur);
}
