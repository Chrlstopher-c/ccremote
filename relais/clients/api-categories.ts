// Responsabilité : les routes des catégories de la barre latérale (Lanterne) — lire le document, le remplacer.
import { z } from 'zod';
import { ListeCategories } from '../../commun/categories.ts';
import type { Registre } from '../registre/registre.ts';
import { json, lireCorps } from './http.ts';

const CorpsCategories = z.object({ categories: ListeCategories });

export function lireCategories(registre: Registre): Response {
  return json({ categories: registre.categories() });
}

// `rapprocher` relance le rapprochement des doublons après l'écriture (une catégorie peut viser une jumelle).
export async function remplacerCategories(
  registre: Registre,
  req: Request,
  rapprocher: () => void = () => undefined,
): Promise<Response> {
  const c = await lireCorps(req, CorpsCategories);
  if (c instanceof Response) return c;
  const normalisees = registre.enregistrerCategories(c.categories);
  rapprocher();
  return json({ categories: normalisees });
}
