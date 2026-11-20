// Responsabilité : les commandes personnelles Claude d'une machine (`<config>/commands/**/*.md`) — listées pour le menu
// « / », créées sans jamais écraser un fichier existant. Ce module ne lit et n'écrit que ce dossier.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { type CommandeMachine, ERREUR_COMMANDE_EXISTANTE, NOM_COMMANDE } from '../../commun/reste.ts';
import { ecrireFrontmatter, lireFrontmatter } from '../configuration/frontmatter.ts';

const MAX_PROFONDEUR = 5;
const MAX_DESCRIPTION = 300;

export type ResultatCommande =
  { readonly ok: true; readonly nom: string } | { readonly ok: false; readonly erreur: string };

/** Les commandes de la configuration, triées par nom ; `nom` = chemin relatif sans `.md`, `/` remplacé par `:`. */
export function listerCommandes(dossierConfig: string, journal: Logger): CommandeMachine[] {
  const racine = join(dossierConfig, 'commands');
  return fichiersMd(racine, '', 0, journal)
    .map((rel) => ({
      nom: rel.replaceAll('/', ':'),
      description: descriptionDe(join(racine, `${rel}.md`), journal),
      chemin: join('commands', `${rel}.md`),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

/** Écrit `<config>/commands/<nom>.md` avec son frontmatter `description`. Un fichier existant n'est jamais écrasé. */
export function creerCommande(
  dossierConfig: string,
  c: { readonly nom: string; readonly description: string; readonly contenu: string },
  journal: Logger,
): ResultatCommande {
  if (!NOM_COMMANDE.test(c.nom)) return { ok: false, erreur: 'nom de commande invalide' };
  const dossier = join(dossierConfig, 'commands');
  try {
    mkdirSync(dossier, { recursive: true });
    const texte = ecrireFrontmatter({ description: c.description }, c.contenu);
    writeFileSync(join(dossier, `${c.nom}.md`), texte, { flag: 'wx' });
    return { ok: true, nom: c.nom };
  } catch (erreur) {
    if (typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'EEXIST') {
      return { ok: false, erreur: ERREUR_COMMANDE_EXISTANTE };
    }
    journal.error({ err: erreur, dossier }, 'création de la commande impossible');
    return { ok: false, erreur: 'écriture de la commande impossible' };
  }
}

// Noms relatifs (sans `.md`, séparés par `/`) des fichiers Markdown du dossier, sous-dossiers compris, sans lien suivi.
function fichiersMd(dossier: string, prefixe: string, profondeur: number, journal: Logger): string[] {
  if (profondeur > MAX_PROFONDEUR) return [];
  let entrees: Dirent[];
  try {
    entrees = readdirSync(dossier, { withFileTypes: true });
  } catch (erreur) {
    if (!(typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'ENOENT')) {
      journal.warn({ err: erreur, dossier }, 'commandes illisibles : dossier ignoré');
    }
    return [];
  }
  return entrees.flatMap((e) => {
    if (e.isDirectory()) return fichiersMd(join(dossier, e.name), `${prefixe}${e.name}/`, profondeur + 1, journal);
    if (e.isFile() && e.name.endsWith('.md')) return [`${prefixe}${e.name.slice(0, -'.md'.length)}`];
    return [];
  });
}

// La description du frontmatter, sinon la première ligne non vide du corps ; vide si le fichier est illisible.
function descriptionDe(chemin: string, journal: Logger): string {
  let texte: string;
  try {
    texte = readFileSync(chemin, 'utf8');
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'commande illisible : description vide');
    return '';
  }
  const declaree = lireFrontmatter(texte)['description'];
  const premiere =
    corpsDe(texte)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? '';
  return (declaree || premiere).slice(0, MAX_DESCRIPTION);
}

// Le texte sans son frontmatter (`---` … `---`), s'il en a un.
function corpsDe(texte: string): string {
  if (!texte.startsWith('---')) return texte;
  const fin = texte.indexOf('\n---', 3);
  return fin < 0 ? texte : texte.slice(fin + '\n---'.length);
}
