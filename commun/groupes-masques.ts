// Responsabilité : le vocabulaire des groupes masqués de la barre latérale (Lanterne) — forme validée et
// normalisation (une clé n'apparaît qu'une fois). Partagé par le relais, qui stocke, et les clients, qui affichent.
import { z } from 'zod';

export const NOMBRE_MAX_GROUPES_MASQUES = 500;

// `cle` identifie le groupe (dossier, machine ou catégorie) ; `machine` et `dossier` le décrivent quand il en a.
export const GroupeMasque = z.object({
  cle: z.string().min(1).max(600),
  libelle: z.string().min(1).max(200),
  genre: z.enum(['dossier', 'machine', 'categorie']),
  machine: z.string().nullable(),
  dossier: z.string().nullable(),
  masqueLe: z.string().max(64),
});
export type GroupeMasque = z.infer<typeof GroupeMasque>;

export const ListeGroupesMasques = z.array(GroupeMasque).max(NOMBRE_MAX_GROUPES_MASQUES);

// Un doublon de clé n'échoue pas la requête : le premier groupe gagne, en silence, comme pour les catégories.
export function normaliserGroupesMasques(liste: readonly GroupeMasque[]): GroupeMasque[] {
  const vues = new Set<string>();
  return liste.filter((g) => {
    if (vues.has(g.cle)) return false;
    vues.add(g.cle);
    return true;
  });
}
