// Responsabilité : les routes des groupes masqués de la barre latérale (Lanterne) — lire, remplacer le document.
import { z } from 'zod';
import { ListeGroupesMasques } from '../../commun/groupes-masques.ts';
import type { Registre } from '../registre/registre.ts';
import { json, lireCorps } from './http.ts';

const CorpsGroupesMasques = z.object({ groupes: ListeGroupesMasques });

export function lireGroupesMasques(registre: Registre): Response {
  return json({ groupes: registre.groupesMasques() });
}

export async function remplacerGroupesMasques(registre: Registre, req: Request): Promise<Response> {
  const c = await lireCorps(req, CorpsGroupesMasques);
  if (c instanceof Response) return c;
  return json({ groupes: registre.enregistrerGroupesMasques(c.groupes) });
}
