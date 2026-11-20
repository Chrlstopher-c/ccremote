// Responsabilité : lire sans lever d'exception les valeurs d'une réponse JSON d'Anthropic (objet, texte, nombre,
// booléen, tableau). Une valeur absente ou d'un autre type donne null, un objet vide ou un tableau vide.
export type Objet = Record<string, unknown>;

export function estObjet(v: unknown): v is Objet {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const objet = (v: unknown): Objet => (estObjet(v) ? v : {});
export const objetOuNull = (v: unknown): Objet | null => (estObjet(v) ? v : null);
export const texte = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
export const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const booleen = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
export const tableau = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const textes = (v: unknown): string[] => tableau(v).filter((x): x is string => typeof x === 'string');

/** Lecture d'un chemin de clés imbriquées : `chemin(l, 'scope', 'model', 'display_name')`. */
export function chemin(v: unknown, ...cles: string[]): unknown {
  return cles.reduce<unknown>((acc, cle) => (estObjet(acc) ? acc[cle] : undefined), v);
}
