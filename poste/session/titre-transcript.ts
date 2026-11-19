// Responsabilité : le titre d'une conversation Claude Code d'après son transcript, dans l'ordre de Claude Desktop :
// renommage (custom-title), titre généré (ai-title), sinon le premier message de Chris. Un « renommage » qui reprend
// le nom par défaut (nom du dossier, « racine » d'un lancement cc) n'est pas un titre.
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Logger } from 'pino';

const LONGUEUR_MAX = 60;

type Objet = Record<string, unknown>;

interface Indices {
  renomme: string | null;
  genere: string | null;
  premier: string | null;
}

/** Nom que Claude Code ou tmux donnent sans choix de Chris : « racine » ou le nom du dossier, suffixé d'un numéro. */
export function estNomParDefaut(nom: string, cwd: string): boolean {
  const dossier = basename(cwd).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(racine|${dossier})(-\\d+)?$`).test(nom);
}

/** Titre provisoire : vide, ou nom par défaut ; le titre réel vient alors du transcript ou du premier message. */
export function titreProvisoire(titre: string, cwd: string): boolean {
  return titre.trim() === '' || estNomParDefaut(titre, cwd);
}

// Une ligne JSON déjà parsée : objet non nul, vérifié à l'exécution ; le cast ne sert qu'à lire ses champs par clé.
const enObjet = (v: unknown): Objet | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objet) : null);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function analyser(ligne: string, indices: Indices): void {
  if (ligne.includes('"custom-title"')) {
    const t = texte((parser(ligne) ?? {})['customTitle']);
    if (t) indices.renomme = t;
  } else if (ligne.includes('"ai-title"')) {
    const t = texte((parser(ligne) ?? {})['aiTitle']);
    if (t) indices.genere = t;
  } else if (indices.premier === null && ligne.includes('"type":"user"')) {
    indices.premier = titreDuMessage(parser(ligne));
  }
}

function parser(ligne: string): Objet | null {
  try {
    return JSON.parse(ligne) as Objet;
  } catch {
    return null; // ligne corrompue ou tronquée : ignorée, comme pour le suivi du transcript
  }
}

/** Titre tiré d'une ligne « user » du transcript : son premier texte de Chris, null pour une méta ou une balise. */
export function titreDuMessage(brut: unknown): string | null {
  const entree = enObjet(brut);
  if (!entree || entree['type'] !== 'user' || entree['isMeta'] === true) return null;
  const contenu = (entree['message'] as Objet | undefined)?.['content'];
  const texteBrut = Array.isArray(contenu)
    ? contenu.map((b) => texte(enObjet(b)?.['type'] === 'text' ? enObjet(b)?.['text'] : null) ?? '').join(' ')
    : (texte(contenu) ?? '');
  const ligne = texteBrut.trim().split('\n')[0]?.trim() ?? '';
  if (!ligne || ligne.startsWith('<')) return null; // balises de commande ou de collage : pas un titre
  return ligne.length > LONGUEUR_MAX ? `${ligne.slice(0, LONGUEUR_MAX)}…` : ligne;
}

/** Titre d'une conversation à partir du contenu de son transcript ; null si aucun n'est lisible. */
export function titreDeContenu(contenu: string, cwd: string): string | null {
  const indices: Indices = { renomme: null, genere: null, premier: null };
  for (const ligne of contenu.split('\n')) if (ligne) analyser(ligne, indices);
  const renomme = indices.renomme;
  const vraiRenomme = renomme !== null && !estNomParDefaut(renomme, cwd) ? renomme : null;
  return vraiRenomme ?? indices.genere ?? indices.premier;
}

/** Titre d'une conversation à partir de son transcript ; null si aucun n'est lisible (le repli reste à l'appelant). */
export function titreDuTranscript(chemin: string, cwd: string, journal: Logger): string | null {
  if (!existsSync(chemin)) return null;
  try {
    return titreDeContenu(readFileSync(chemin, 'utf8'), cwd);
  } catch (erreur) {
    journal.warn({ chemin, err: erreur }, 'titre : transcript illisible');
    return null;
  }
}
