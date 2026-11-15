// Responsabilité : servir un dossier de fichiers statiques (bureau, Agent HQ) — fichier exact, jamais un chemin hors du
// dossier. Le repli (index.html) est décidé par l'appelant.
import { statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const CACHE_IMMUABLE = { 'cache-control': 'public, max-age=31536000, immutable' };

export function servirStatique(racine: string, cheminBrut: string): Response | null {
  const cible = cibleDans(racine, cheminBrut);
  if (!cible || !estFichier(cible)) return null;
  const immuable = decoderSur(cheminBrut)?.startsWith('/assets/') === true;
  return new Response(Bun.file(cible), { headers: immuable ? CACHE_IMMUABLE : {} });
}

export function indexSpa(racine: string): Response {
  const index = resolve(racine, 'index.html');
  return estFichier(index) ? new Response(Bun.file(index)) : new Response('interface non construite', { status: 503 });
}

function decoderSur(chemin: string): string | null {
  try {
    return decodeURIComponent(chemin);
  } catch {
    return null;
  }
}

function cibleDans(racine: string, cheminBrut: string): string | null {
  const chemin = decoderSur(cheminBrut);
  if (chemin === null) return null;
  const base = resolve(racine);
  const cible = resolve(base, `.${normaliserAbsolu(chemin)}`);
  return cible.startsWith(base + sep) ? cible : null;
}

// Un chemin absolu ne peut pas remonter au-dessus de sa racine : `/../x` devient `/x`.
function normaliserAbsolu(chemin: string): string {
  const segments: string[] = [];
  for (const s of chemin.split(/[/\\]/)) {
    if (s === '' || s === '.') continue;
    if (s === '..') segments.pop();
    else segments.push(s);
  }
  return `/${segments.join('/')}`;
}

function estFichier(chemin: string): boolean {
  return statSync(chemin, { throwIfNoEntry: false })?.isFile() === true;
}
