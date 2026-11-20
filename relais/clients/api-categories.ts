// Responsabilité : les routes des catégories de la barre latérale (Lanterne) — lire le document, le remplacer.
import { z } from 'zod';
import { ListeCategories } from '../../commun/categories.ts';
import type { Registre } from '../registre/registre.ts';
import { json, lireCorps } from './http.ts';

const CorpsCategories = z.object({ categories: ListeCategories });

export function lireCategories(registre: Registre): Response {
  return json({ categories: registre.categories() });
}

export async function remplacerCategories(registre: Registre, req: Request): Promise<Response> {
  const c = await lireCorps(req, CorpsCategories);
  if (c instanceof Response) return c;
  return json({ categories: registre.enregistrerCategories(c.categories) });
}
