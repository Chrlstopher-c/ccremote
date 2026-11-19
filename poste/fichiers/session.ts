// Responsabilité : le panneau Fichiers d'une session sur ce poste — arbre, lecture et écriture atomique de fichiers
// sous le dossier de la session, jamais en dehors (liens compris). Mêmes règles que le panneau local de Lanterne :
// fichiers cachés visibles, `.git` masqué, dossiers d'abord, 2000 entrées au plus.
import { randomUUID } from 'node:crypto';
import { lstat, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import type { Logger } from 'pino';
import type { EntreeFichier } from '../../commun/appareil.ts';
import { ContenuSession, ListeSession, TAILLE_MAX_TEXTE_SESSION } from '../../commun/fichiers-session.ts';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';

export type CommandeFichiersSession = Extract<
  CommandeRelais,
  { kind: 'session_arbre' | 'session_lire' | 'session_ecrire' }
>;

export interface ResultatFichiersSession {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}

const MAX_ENTREES = 2000;
const FENETRE_BINAIRE = 8000;

export const estFichiersSession = (c: CommandeRelais): c is CommandeFichiersSession =>
  c.kind === 'session_arbre' || c.kind === 'session_lire' || c.kind === 'session_ecrire';

/** Erreur de confinement : le chemin sort du dossier de la session (ou n'en est pas un). */
class HorsSession extends Error {
  readonly code = 'HORS_SESSION';
}

function segmentsDe(relatif: string): string[] {
  if (relatif.includes('\0') || isAbsolute(relatif)) throw new HorsSession('chemin hors du dossier de la session');
  const segments = relatif.split(/[\\/]/).filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) throw new HorsSession('chemin hors du dossier de la session');
  return segments;
}

function estDedans(racine: string, reel: string): boolean {
  return reel === racine || reel.startsWith(racine + sep);
}

/**
 * Chemin réel d'une cible sous `racine`. Un fichier existant est résolu (liens compris) et doit rester dans la racine ;
 * un fichier à créer doit avoir un dossier parent qui y reste.
 */
async function cibleDans(racine: string, relatif: string): Promise<string> {
  const segments = segmentsDe(relatif);
  const base = await realpath(racine);
  const candidat = join(base, ...segments);
  const reel = await realpath(candidat).catch(() => null);
  if (reel !== null) {
    if (!estDedans(base, reel)) throw new HorsSession('chemin hors du dossier de la session');
    return reel;
  }
  const parent = await realpath(dirname(candidat));
  if (!estDedans(base, parent)) throw new HorsSession('chemin hors du dossier de la session');
  return candidat;
}

function relatifDe(racine: string, absolu: string): string {
  const base = racine.endsWith(sep) ? racine : racine + sep;
  return absolu === racine ? '' : absolu.slice(base.length).split(sep).join('/');
}

async function entree(dossier: string, nom: string): Promise<EntreeFichier | null> {
  const chemin = join(dossier, nom);
  const brut = await lstat(chemin).catch(() => null);
  if (!brut) return null;
  let type: EntreeFichier['type'] = brut.isSymbolicLink()
    ? 'lien'
    : brut.isDirectory()
      ? 'dossier'
      : brut.isFile()
        ? 'fichier'
        : 'autre';
  let taille = brut.size;
  if (type === 'lien') {
    const cible = await stat(chemin).catch(() => null);
    if (cible?.isDirectory()) type = 'dossier';
    else if (cible?.isFile()) taille = cible.size;
  }
  return { nom, type, taille, modifie: brut.mtime.toISOString(), cache: nom.startsWith('.') };
}

async function arbre(racine: string, relatif: string): Promise<ListeSession> {
  const dossier = await cibleDans(racine, relatif);
  const base = await realpath(racine);
  const noms = (await readdir(dossier)).filter((nom) => nom !== '.git');
  const entrees = (await Promise.all(noms.map((nom) => entree(dossier, nom)))).filter(
    (e): e is EntreeFichier => e !== null,
  );
  entrees.sort((a, b) => {
    if ((a.type === 'dossier') !== (b.type === 'dossier')) return a.type === 'dossier' ? -1 : 1;
    return a.nom.toLowerCase().localeCompare(b.nom.toLowerCase());
  });
  const chemin = relatifDe(base, dossier);
  const parent = dossier === base ? null : relatifDe(base, dirname(dossier));
  return { chemin, parent, entrees: entrees.slice(0, MAX_ENTREES) };
}

/** Texte UTF-8 ; un fichier coupé au milieu d'un caractère reste lisible jusqu'à la coupure. */
function decoder(octets: Buffer, tronque: boolean): string | null {
  const decodeur = new TextDecoder('utf-8', { fatal: true });
  try {
    return decodeur.decode(octets);
  } catch {
    if (!tronque) return null;
    for (let retrait = 1; retrait <= 3; retrait += 1) {
      try {
        return decodeur.decode(octets.subarray(0, octets.length - retrait));
      } catch {
        // coupure d'un caractère multi-octet : on recule d'un octet de plus
      }
    }
    return null;
  }
}

async function lire(racine: string, relatif: string): Promise<ContenuSession> {
  const cible = await cibleDans(racine, relatif);
  const brut = await stat(cible);
  if (!brut.isFile()) throw new Error(`${relatif} n'est pas un fichier`);
  const f = await open(cible, 'r');
  try {
    const longueur = Math.min(brut.size, TAILLE_MAX_TEXTE_SESSION);
    const tampon = Buffer.alloc(longueur);
    if (longueur > 0) await f.read(tampon, 0, longueur, 0);
    const tronque = brut.size > TAILLE_MAX_TEXTE_SESSION;
    const binaire = tampon.subarray(0, FENETRE_BINAIRE).includes(0);
    const texte = binaire ? null : decoder(tampon, tronque);
    return {
      chemin: relatifDe(await realpath(racine), cible),
      taille: brut.size,
      binaire: binaire || texte === null,
      tronque,
      texte,
    };
  } finally {
    await f.close();
  }
}

/** Écriture atomique : un fichier temporaire voisin, synchronisé, puis renommé sur la cible (mode conservé). */
async function ecrire(racine: string, relatif: string, texte: string, journal: Logger): Promise<number> {
  const octets = Buffer.from(texte, 'utf8');
  if (octets.length > TAILLE_MAX_TEXTE_SESSION) throw new Error('fichier trop grand pour l’éditeur');
  const cible = await cibleDans(racine, relatif);
  const existant = await stat(cible).catch(() => null);
  if (existant && !existant.isFile()) throw new Error(`${relatif} n'est pas un fichier`);
  const mode = existant ? existant.mode & 0o777 : 0o644;
  const temporaire = join(dirname(cible), `.${basename(cible)}.${randomUUID()}.tmp`);
  try {
    const f = await open(temporaire, 'wx', mode);
    try {
      await f.writeFile(octets);
      await f.sync();
    } finally {
      await f.close();
    }
    await rename(temporaire, cible);
  } catch (erreur) {
    await rm(temporaire, { force: true }).catch((nettoyage: unknown) =>
      journal.warn({ err: nettoyage, fichier: temporaire }, 'fichier temporaire non retiré'),
    );
    throw erreur;
  }
  return octets.length;
}

function messageDe(erreur: unknown): string {
  if (erreur instanceof HorsSession) return erreur.message;
  const code = (erreur as NodeJS.ErrnoException).code; // erreur système : seul son code sert au message
  if (code === 'ENOENT') return 'introuvable';
  if (code === 'EACCES' || code === 'EPERM') return 'accès refusé';
  if (code === 'EISDIR') return 'c’est un dossier';
  if (code === 'ENOTDIR') return 'ce n’est pas un dossier';
  return erreur instanceof Error ? erreur.message : String(erreur);
}

/** Exécute une commande du panneau Fichiers sur le dossier `racine` de la session. Une erreur devient un refus lisible. */
export async function executerFichiersSession(
  c: CommandeFichiersSession,
  racine: string,
  journal: Logger,
): Promise<ResultatFichiersSession> {
  try {
    if (c.kind === 'session_arbre') return { ok: true, donnees: ListeSession.parse(await arbre(racine, c.chemin)) };
    if (c.kind === 'session_lire') return { ok: true, donnees: ContenuSession.parse(await lire(racine, c.chemin)) };
    const taille = await ecrire(racine, c.chemin, c.texte, journal);
    journal.info({ commande: c.kind, taille }, 'fichier de session enregistré');
    return { ok: true, donnees: { taille } };
  } catch (erreur) {
    journal.warn(
      { commande: c.kind, code: (erreur as NodeJS.ErrnoException).code },
      'panneau Fichiers de session refusé',
    );
    return { ok: false, erreur: messageDe(erreur) };
  }
}
