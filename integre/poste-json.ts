// Responsabilité : réécrire poste.json à chaque lancement du moteur intégré sans perdre ce que Chris a réglé depuis
// l'appli (comptes ajoutés, comptes dont les sessions Remote Control sont suivies) : ces champs sont repris du fichier.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Logger } from 'pino';
import type { ContenuPosteJson } from './environnement.ts';

const CHAMPS_CONSERVES = ['comptes', 'distants'] as const;

/** Champs réglés depuis l'appli, lus dans le poste.json existant ; fichier absent ou illisible : aucun. */
export function champsConserves(texte: string | null): Record<string, unknown> {
  if (texte === null) return {};
  try {
    const brut: unknown = JSON.parse(texte);
    if (typeof brut !== 'object' || brut === null) return {};
    const entrees = Object.entries(brut).filter(([cle]) => (CHAMPS_CONSERVES as readonly string[]).includes(cle));
    return Object.fromEntries(entrees);
  } catch {
    return {};
  }
}

export function ecrirePosteJson(chemin: string, contenu: ContenuPosteJson, journal: Logger): void {
  let existant: string | null = null;
  try {
    existant = readFileSync(chemin, 'utf8');
  } catch {
    existant = null; // premier lancement
  }
  const conserves = champsConserves(existant);
  if (existant !== null && Object.keys(conserves).length === 0) journal.debug('poste.json : aucun réglage à conserver');
  writeFileSync(chemin, `${JSON.stringify({ ...contenu, ...conserves }, null, 2)}\n`, { mode: 0o600 });
}
