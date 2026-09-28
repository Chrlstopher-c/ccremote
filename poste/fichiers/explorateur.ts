// Responsabilité : les fichiers de la machine vus depuis Quart — lister, lire et écrire par morceaux, renommer,
// supprimer, créer un dossier. Le poste agit avec les droits de son compte Unix, ni plus ni moins.
import { lstat, mkdir, open, readdir, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Logger } from 'pino';
import type { EntreeFichier, ListeDossier, MorceauFichier } from '../../commun/appareil.ts';

export interface Resultat {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}

/** `~` et les chemins relatifs partent du dossier personnel : c'est là qu'on atterrit en ouvrant un appareil. */
export function cheminAbsolu(chemin: string | undefined): string {
  const accueil = homedir();
  if (!chemin || chemin === '~') return accueil;
  if (chemin.startsWith('~/')) return join(accueil, chemin.slice(2));
  return isAbsolute(chemin) ? resolve(chemin) : resolve(accueil, chemin);
}

function typeDe(s: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): EntreeFichier['type'] {
  if (s.isSymbolicLink()) return 'lien';
  if (s.isDirectory()) return 'dossier';
  return s.isFile() ? 'fichier' : 'autre';
}

async function entree(dossier: string, nom: string): Promise<EntreeFichier> {
  const chemin = join(dossier, nom);
  const brut = await lstat(chemin);
  let type = typeDe(brut);
  let taille = brut.size;
  // Un lien vers un dossier se parcourt comme un dossier ; un lien cassé reste un lien.
  if (type === 'lien') {
    const cible = await stat(chemin).catch(() => null);
    if (cible?.isDirectory()) type = 'dossier';
    else if (cible?.isFile()) taille = cible.size;
  }
  return { nom, type, taille, modifie: brut.mtime.toISOString(), cache: nom.startsWith('.') };
}

async function lister(chemin: string | undefined): Promise<ListeDossier> {
  const dossier = cheminAbsolu(chemin);
  const noms = await readdir(dossier);
  const entrees = await Promise.all(noms.map((nom) => entree(dossier, nom).catch(() => null)));
  const parent = dirname(dossier);
  return {
    chemin: dossier,
    parent: parent === dossier ? null : parent,
    accueil: homedir(),
    entrees: entrees.filter((e): e is EntreeFichier => e !== null),
  };
}

async function lire(chemin: string, debut: number, longueur: number): Promise<MorceauFichier> {
  const f = await open(cheminAbsolu(chemin), 'r');
  try {
    const { size } = await f.stat();
    const tampon = Buffer.alloc(Math.max(0, Math.min(longueur, size - debut)));
    if (tampon.length > 0) await f.read(tampon, 0, tampon.length, debut);
    return { taille: size, base64: tampon.toString('base64') };
  } finally {
    await f.close();
  }
}

async function ecrire(chemin: string, base64: string, ajout: boolean): Promise<void> {
  const cible = cheminAbsolu(chemin);
  const octets = Buffer.from(base64, 'base64');
  await (ajout ? appendFile(cible, octets) : writeFile(cible, octets));
}

// `rename` écrase la cible sans prévenir : un renommage ne doit jamais effacer un autre fichier.
async function renommer(de: string, vers: string): Promise<void> {
  if (await lstat(vers).catch(() => null)) throw Object.assign(new Error('existe déjà'), { code: 'EEXIST' });
  await rename(de, vers);
}

type CommandeFichiers =
  | { kind: 'fichiers_lister'; chemin?: string }
  | { kind: 'fichier_lire'; chemin: string; debut: number; longueur: number }
  | { kind: 'fichier_ecrire'; chemin: string; base64: string; ajout: boolean }
  | { kind: 'fichier_supprimer'; chemin: string }
  | { kind: 'fichier_renommer'; de: string; vers: string }
  | { kind: 'dossier_creer'; chemin: string };

async function agir(c: CommandeFichiers): Promise<unknown> {
  switch (c.kind) {
    case 'fichiers_lister':
      return lister(c.chemin);
    case 'fichier_lire':
      return lire(c.chemin, c.debut, c.longueur);
    case 'fichier_ecrire':
      return ecrire(c.chemin, c.base64, c.ajout);
    case 'fichier_supprimer':
      return rm(cheminAbsolu(c.chemin), { recursive: true });
    case 'fichier_renommer':
      return renommer(cheminAbsolu(c.de), cheminAbsolu(c.vers));
    case 'dossier_creer':
      return mkdir(cheminAbsolu(c.chemin), { recursive: true });
  }
}

/** Une erreur du système de fichiers devient un refus lisible, jamais une exception qui remonte au lien. */
export async function executerFichiers(c: CommandeFichiers, journal: Logger): Promise<Resultat> {
  try {
    const donnees = await agir(c);
    if (c.kind !== 'fichiers_lister' && c.kind !== 'fichier_lire')
      journal.info({ commande: c.kind }, 'fichiers modifiés');
    return { ok: true, donnees: donnees ?? { ok: true } };
  } catch (erreur) {
    const code = (erreur as NodeJS.ErrnoException).code; // erreur système de Node : seul son code nous intéresse
    journal.warn({ commande: c.kind, code }, 'opération sur les fichiers refusée');
    return { ok: false, erreur: messageDe(code, erreur) };
  }
}

function messageDe(code: string | undefined, erreur: unknown): string {
  if (code === 'ENOENT') return 'introuvable';
  if (code === 'EACCES' || code === 'EPERM') return 'accès refusé';
  if (code === 'EISDIR') return 'c’est un dossier';
  if (code === 'ENOTDIR') return 'ce n’est pas un dossier';
  if (code === 'EEXIST') return 'existe déjà';
  return String(erreur);
}
