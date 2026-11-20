// Responsabilité : le vocabulaire des catégories de la barre latérale (Lanterne) — forme validée et normalisation (une
// session n'appartient qu'à une catégorie). Partagé par le relais, qui stocke, et les clients, qui affichent.
import { z } from 'zod';

export const NOMBRE_MAX_CATEGORIES = 200;
export const NOMBRE_MAX_SESSIONS_CATEGORIE = 5000;

// Identifiants de session : non vérifiés contre le registre, une session découverte peut ne pas y figurer encore.
export const Categorie = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  nom: z.string().trim().min(1).max(80),
  replie: z.boolean(),
  sessions: z.array(z.string().min(1).max(200)).max(NOMBRE_MAX_SESSIONS_CATEGORIE),
});
export type Categorie = z.infer<typeof Categorie>;

const IdentifiantsUniques = (categories: readonly Categorie[]): boolean =>
  new Set(categories.map((c) => c.id)).size === categories.length;

// Un doublon d'identifiant fait échouer la requête : il n'est pas corrigé en silence.
export const ListeCategories = z
  .array(Categorie)
  .max(NOMBRE_MAX_CATEGORIES)
  .refine(IdentifiantsUniques, { message: 'identifiants de catégorie en double' });

// Une session n'apparaît qu'une fois : la première occurrence (catégories puis sessions, dans l'ordre) gagne.
export function normaliserCategories(liste: readonly Categorie[]): Categorie[] {
  const vues = new Set<string>();
  return liste.map((c) => ({
    ...c,
    sessions: c.sessions.filter((s) => {
      if (vues.has(s)) return false;
      vues.add(s);
      return true;
    }),
  }));
}
