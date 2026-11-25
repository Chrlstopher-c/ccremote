// Responsabilité : les routes de l'extinction automatique (Lanterne, Paramètres) — lire le délai, remplacer le délai.
// Le réglage est celui du nœud entier : l'id de machine de l'adresse ne sert qu'au routage fédéré.
import { z } from 'zod';
import type { ReglageExtinctionAuto } from '../sessions/extinction-auto-reglage.ts';
import { json, lireCorps } from './http.ts';

export const DELAI_MAX_MINUTES = 10_080; // une semaine

const CorpsExtinctionAuto = z.object({
  delaiMinutes: z
    .number()
    .int()
    .min(1)
    .max(DELAI_MAX_MINUTES)
    .nullable(),
});

export function lireExtinctionAuto(reglage: ReglageExtinctionAuto): Response {
  return json({ delaiMinutes: reglage.delai() });
}

export async function remplacerExtinctionAuto(reglage: ReglageExtinctionAuto, req: Request): Promise<Response> {
  const c = await lireCorps(req, CorpsExtinctionAuto);
  if (c instanceof Response) return c;
  return json({ delaiMinutes: reglage.definir(c.delaiMinutes) });
}
