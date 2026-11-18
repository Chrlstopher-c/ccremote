// Responsabilité : le vocabulaire du panneau de session — contexte, connecteurs et tâches de fond d'une session SDK.
// Lu en direct sur le poste (lectures, sans effet) puis relayé par le relais à Lanterne et aux clients.
import { z } from 'zod';

export const GenreCategorie = z.enum(['utilise', 'libre', 'tampon', 'differe']);
export type GenreCategorie = z.infer<typeof GenreCategorie>;

export const CategorieContexte = z.object({
  id: z.string(),
  libelle: z.string(),
  jetons: z.number(),
  genre: GenreCategorie,
});
export type CategorieContexte = z.infer<typeof CategorieContexte>;

// `differe` : l'outil n'est chargé qu'à la demande, il ne pèse pas encore dans l'utilisé.
export const OutilMcp = z.object({
  serveur: z.string(),
  outil: z.string(),
  jetons: z.number(),
  differe: z.boolean(),
});
export type OutilMcp = z.infer<typeof OutilMcp>;

export const FichierMemoire = z.object({
  chemin: z.string(),
  type: z.string(),
  jetons: z.number(),
});
export type FichierMemoire = z.infer<typeof FichierMemoire>;

export const ContexteSession = z.object({
  modele: z.string(),
  fenetre: z.number(),
  utilises: z.number(),
  pourcentage: z.number(),
  categories: z.array(CategorieContexte),
  categoriesDifferees: z.array(CategorieContexte),
  outilsMcp: z.array(OutilMcp),
  fichiersMemoire: z.array(FichierMemoire),
});
export type ContexteSession = z.infer<typeof ContexteSession>;

// `statut` : la valeur brute du SDK (connected, failed, needs-auth, pending, disabled).
export const ConnecteurSession = z.object({ nom: z.string(), statut: z.string() });
export type ConnecteurSession = z.infer<typeof ConnecteurSession>;

export const StatutTache = z.enum(['en_attente', 'en_cours', 'pausee', 'terminee', 'echouee', 'arretee']);
export type StatutTache = z.infer<typeof StatutTache>;

export const TacheSession = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  statut: StatutTache,
  arrierePlan: z.boolean(),
  sousAgent: z.string().nullable(),
  modele: z.string().nullable(),
  parent: z.string().nullable(),
  activite: z.string().nullable(),
  outils: z.number(),
  jetons: z.number(),
  dureeMs: z.number(),
  debutLe: z.string(),
  finLe: z.string().nullable(),
});
export type TacheSession = z.infer<typeof TacheSession>;

export const DetailTacheSession = TacheSession.extend({ prompt: z.string().nullable() });
export type DetailTacheSession = z.infer<typeof DetailTacheSession>;
