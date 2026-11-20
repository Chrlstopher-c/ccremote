// Responsabilité : lire une ligne du transcript (JSON) et les petits accès typés sur des valeurs non typées. Les lignes
// énormes et sans parité (requêtes API, instantanés de prompt) sont écartées avant le JSON.
import type { Logger } from 'pino';

export type Objet = Record<string, unknown>;

const PREFIXE_IGNOREE = '{"type":"api-request';

export function estObjet(valeur: unknown): valeur is Objet {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

export function texte(valeur: unknown): string | null {
  return typeof valeur === 'string' ? valeur : null;
}

export function nombre(valeur: unknown): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : 0;
}

/** Les blocs d'un contenu de message (tableau de blocs) ; un contenu texte n'en a pas. */
export function blocs(contenu: unknown): Objet[] {
  return Array.isArray(contenu) ? contenu.filter(estObjet) : [];
}

/** La ligne décodée, ou null si elle est illisible ou sans intérêt pour la parité. */
export function lireLigne(brut: string, journal?: Logger): Objet | null {
  if (brut.startsWith(PREFIXE_IGNOREE) || brut.trim() === '') return null;
  let valeur: unknown;
  try {
    valeur = JSON.parse(brut);
  } catch (erreur) {
    journal?.debug({ err: erreur }, 'ligne de transcript illisible : ignorée');
    return null;
  }
  if (!estObjet(valeur)) return null;
  const piece = valeur['attachment'];
  if (valeur['type'] === 'attachment' && estObjet(piece) && piece['type'] === 'prompt_snapshot') return null;
  return valeur;
}
