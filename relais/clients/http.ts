// Responsabilité : les petites briques HTTP communes aux routes (réponses JSON, lecture validée du corps).
import type { z } from 'zod';

export function json(donnees: unknown, statut = 200, entetes: Record<string, string> = {}): Response {
  return Response.json(donnees, { status: statut, headers: { 'cache-control': 'no-store', ...entetes } });
}

export function erreur(message: string, statut = 400): Response {
  return json({ erreur: message }, statut);
}

export async function lireCorps<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S> | Response> {
  let brut: unknown;
  try {
    brut = await req.json();
  } catch {
    return erreur('corps JSON attendu');
  }
  const r = schema.safeParse(brut);
  return r.success
    ? r.data
    : erreur(`requête invalide : ${r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join(' ; ')}`);
}

export function entier(v: string | null, defaut: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? n : defaut;
}
