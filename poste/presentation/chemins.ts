// Responsabilité : confiner les fichiers que l'agent présente à Chris — sous le dossier de la session, sous une racine
// de projet du poste, ou dans le dossier temporaire (captures, sorties d'outils). Un lien qui sort de ces dossiers est
// refusé : on regarde le chemin réel, pas celui qui est écrit.
import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';

export type ResultatChemin =
  { readonly ok: true; readonly chemin: string } | { readonly ok: false; readonly erreur: string };

function dossierReel(dossier: string): string | null {
  try {
    return realpathSync(dossier);
  } catch {
    return null;
  }
}

function dedans(fichier: string, dossier: string): boolean {
  return fichier === dossier || fichier.startsWith(dossier.endsWith(sep) ? dossier : `${dossier}${sep}`);
}

export function resoudreChemin(saisi: string, cwd: string, racines: readonly string[]): ResultatChemin {
  const expande = saisi === '~' || saisi.startsWith('~/') ? resolve(homedir(), saisi.slice(2)) : saisi;
  const absolu = isAbsolute(expande) ? expande : resolve(cwd, expande);
  let reel: string;
  try {
    reel = realpathSync(absolu);
    if (!statSync(reel).isFile()) return { ok: false, erreur: `pas un fichier : ${saisi}` };
  } catch {
    return { ok: false, erreur: `fichier introuvable : ${saisi}` };
  }
  const autorises = [cwd, ...racines, tmpdir()].map(dossierReel).filter((d): d is string => d !== null);
  return autorises.some((d) => dedans(reel, d))
    ? { ok: true, chemin: reel }
    : { ok: false, erreur: `chemin hors des dossiers autorisés : ${saisi}` };
}
