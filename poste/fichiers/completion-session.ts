// Responsabilité : les données des menus « / » et « @ » d'une session tenue sur ce poste — compétences et commandes
// (projet puis utilisateur), fichiers du projet (respect du `.gitignore`), couleurs git de l'arbre. Lecture seule.
import { execFile } from 'node:child_process';
import { readdirSync, type Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from 'pino';
import type { CompetenceSession, EtatGitSession } from '../../commun/fichiers-session.ts';

const executer = promisify(execFile);

/** Nombre maximal de fichiers listés pour le menu « @ » ; au-delà, la liste est coupée et le journal le note. */
export const MAX_FICHIERS_PROJET = 5000;

/** Dossiers jamais parcourus hors dépôt : dépendances, sorties de build et environnements Python. */
const DOSSIERS_IGNORES = new Set(['node_modules', 'target', 'dist', 'build', '__pycache__', 'venv']);

async function git(racine: string, args: string[], journal: Logger): Promise<string | null> {
  try {
    const { stdout } = await executer('git', ['-C', racine, ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (erreur) {
    journal.debug({ racine, code: (erreur as NodeJS.ErrnoException).code }, 'git indisponible pour le menu');
    return null;
  }
}

/** Compétences du projet puis de l'utilisateur ; à nom égal, celle du projet l'emporte. Triées par nom. */
export async function competencesSession(
  racine: string,
  utilisateur: string,
  journal: Logger,
): Promise<CompetenceSession[]> {
  const sources: Array<[string, boolean]> = [
    [join(racine, '.claude'), true],
    [join(utilisateur, '.claude'), false],
  ];
  const trouvees = new Map<string, CompetenceSession>();
  for (const [dossier, projet] of sources) {
    for (const competence of await lireCompetences(dossier, projet, journal)) {
      if (!trouvees.has(competence.nom)) trouvees.set(competence.nom, competence);
    }
  }
  return [...trouvees.values()].sort((a, b) => a.nom.toLowerCase().localeCompare(b.nom.toLowerCase()));
}

async function lireCompetences(claude: string, projet: boolean, journal: Logger): Promise<CompetenceSession[]> {
  const skills = await lireSkills(join(claude, 'skills'), projet, journal);
  const commandes = await lireCommandes(join(claude, 'commands'), projet, journal);
  return [...skills, ...commandes];
}

async function lireSkills(dossier: string, projet: boolean, journal: Logger): Promise<CompetenceSession[]> {
  const noms = await lister(dossier, journal);
  const lues = await Promise.all(
    noms.map(async (nom): Promise<CompetenceSession | null> => {
      const texte = await lireTexte(join(dossier, nom, 'SKILL.md'));
      if (texte === null) return null;
      const entete = enteteDe(texte);
      return { nom: entete.nom ?? nom, description: entete.description ?? '', projet };
    }),
  );
  return lues.filter((competence): competence is CompetenceSession => competence !== null);
}

async function lireCommandes(dossier: string, projet: boolean, journal: Logger): Promise<CompetenceSession[]> {
  const fichiers = (await lister(dossier, journal)).filter((nom) => nom.endsWith('.md'));
  const lues = await Promise.all(
    fichiers.map(async (nom): Promise<CompetenceSession | null> => {
      const texte = await lireTexte(join(dossier, nom));
      if (texte === null) return null;
      return { nom: nom.slice(0, -'.md'.length), description: enteteDe(texte).description ?? '', projet };
    }),
  );
  return lues.filter((competence): competence is CompetenceSession => competence !== null);
}

async function lister(dossier: string, journal: Logger): Promise<string[]> {
  try {
    return await readdir(dossier);
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') {
      journal.warn({ dossier, code: (erreur as NodeJS.ErrnoException).code }, 'dossier de compétences illisible');
    }
    return [];
  }
}

async function lireTexte(chemin: string): Promise<string | null> {
  try {
    return await readFile(chemin, 'utf8');
  } catch {
    return null;
  }
}

/** `name` et `description` de l'en-tête YAML (entre deux lignes `---`), comme le menu local. */
export function enteteDe(texte: string): { nom: string | null; description: string | null } {
  const lignes = texte.split(/\r?\n/);
  if (lignes[0]?.trim() !== '---') return { nom: null, description: null };
  const entete: { nom: string | null; description: string | null } = { nom: null, description: null };
  for (const ligne of lignes.slice(1)) {
    if (ligne.trim() === '---') break;
    const nom = /^name:(.*)$/.exec(ligne);
    const description = /^description:(.*)$/.exec(ligne);
    if (nom?.[1] !== undefined) entete.nom = valeur(nom[1]) || null;
    if (description?.[1] !== undefined) entete.description = valeur(description[1]) || null;
  }
  return entete;
}

function valeur(brute: string): string {
  return brute.trim().replace(/^["']|["']$/g, '').trim();
}

/** Chemins relatifs des fichiers du dossier, triés. Dans un dépôt : suivis et non ignorés (`.gitignore`). */
export async function fichiersProjet(racine: string, journal: Logger): Promise<string[]> {
  const sortie = await git(racine, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], journal);
  const fichiers = sortie !== null ? sortie.split('\0').filter((c) => c !== '') : parcourir(racine);
  fichiers.sort();
  if (fichiers.length > MAX_FICHIERS_PROJET) {
    journal.warn({ total: fichiers.length }, 'liste des fichiers du menu @ coupée');
    fichiers.length = MAX_FICHIERS_PROJET;
  }
  return fichiers;
}

/** Parcours sans dépôt : dossiers cachés, dépendances et sorties de build ignorés, liens non suivis. */
function parcourir(racine: string): string[] {
  const fichiers: string[] = [];
  const pile: string[] = [''];
  while (pile.length > 0) {
    const relatif = pile.pop() ?? '';
    let entrees: Dirent[];
    try {
      entrees = readdirSync(join(racine, relatif), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entree of entrees) {
      const chemin = relatif === '' ? entree.name : `${relatif}/${entree.name}`;
      if (entree.isDirectory()) {
        if (!entree.name.startsWith('.') && !DOSSIERS_IGNORES.has(entree.name)) pile.push(chemin);
      } else if (entree.isFile()) {
        fichiers.push(chemin);
      }
    }
  }
  return fichiers;
}

/** Couleurs git des fichiers non commités, par chemin relatif au dossier (vide hors dépôt). */
export async function etatsGit(racine: string, journal: Logger): Promise<Map<string, EtatGitSession>> {
  const prefixe = (await git(racine, ['rev-parse', '--show-prefix'], journal))?.trim();
  const etats = new Map<string, EtatGitSession>();
  if (prefixe === undefined) return etats;
  const statut = await git(racine, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], journal);
  for (const entree of (statut ?? '').split('\0')) {
    if (entree.length < 4) continue;
    const etat = etatDe(entree.slice(0, 2));
    const chemin = entree.slice(3);
    if (chemin.startsWith(prefixe)) etats.set(chemin.slice(prefixe.length), etat);
  }
  return etats;
}

/** `XY` de `git status` : `??` ou ajout = ajouté ; suppression = supprimé ; le reste = modifié. */
function etatDe(xy: string): EtatGitSession {
  if (xy === '??' || xy.includes('A')) return 'ajoute';
  if (xy.includes('D')) return 'supprime';
  return 'modifie';
}
