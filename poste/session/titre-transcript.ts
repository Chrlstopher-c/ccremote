// Responsabilité : le titre d'une conversation Claude Code d'après son transcript, dans l'ordre de Claude Desktop :
// renommage (custom-title), titre généré (ai-title), sinon le premier message de Chris. Un « renommage » qui reprend
// le nom par défaut (nom du dossier, « racine » d'un lancement cc) n'est pas un titre.
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Logger } from 'pino';

const LONGUEUR_MAX = 60;
const NOM_PAR_DEFAUT = /^racine(-\d+)?$/;

type Objet = Record<string, unknown>;

interface Indices {
  renomme: string | null;
  genere: string | null;
  premier: string | null;
}

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function analyser(ligne: string, indices: Indices): void {
  if (ligne.includes('"custom-title"')) {
    const t = texte((parser(ligne) ?? {})['customTitle']);
    if (t) indices.renomme = t;
  } else if (ligne.includes('"ai-title"')) {
    const t = texte((parser(ligne) ?? {})['aiTitle']);
    if (t) indices.genere = t;
  } else if (indices.premier === null && ligne.includes('"type":"user"')) {
    indices.premier = premierMessage(parser(ligne));
  }
}

function parser(ligne: string): Objet | null {
  try {
    return JSON.parse(ligne) as Objet;
  } catch {
    return null; // ligne corrompue ou tronquée : ignorée, comme pour le suivi du transcript
  }
}

function premierMessage(entree: Objet | null): string | null {
  if (!entree || entree['type'] !== 'user' || entree['isMeta'] === true) return null;
  const contenu = (entree['message'] as Objet | undefined)?.['content'];
  const brut = Array.isArray(contenu)
    ? contenu.map((b) => texte((b as Objet)['type'] === 'text' ? (b as Objet)['text'] : null) ?? '').join(' ')
    : (texte(contenu) ?? '');
  const ligne = brut.trim().split('\n')[0]?.trim() ?? '';
  if (!ligne || ligne.startsWith('<')) return null; // balises de commande ou de collage : pas un titre
  return ligne.length > LONGUEUR_MAX ? `${ligne.slice(0, LONGUEUR_MAX)}…` : ligne;
}

/** Titre d'une conversation à partir de son transcript ; null si aucun n'est lisible (le repli reste à l'appelant). */
export function titreDuTranscript(chemin: string, cwd: string, journal: Logger): string | null {
  if (!existsSync(chemin)) return null;
  let contenu: string;
  try {
    contenu = readFileSync(chemin, 'utf8');
  } catch (erreur) {
    journal.warn({ chemin, err: erreur }, 'titre : transcript illisible');
    return null;
  }
  const indices: Indices = { renomme: null, genere: null, premier: null };
  for (const ligne of contenu.split('\n')) if (ligne) analyser(ligne, indices);
  const nomDossier = basename(cwd);
  const renomme = indices.renomme;
  const vraiRenomme = renomme !== null && !NOM_PAR_DEFAUT.test(renomme) && renomme !== nomDossier ? renomme : null;
  return vraiRenomme ?? indices.genere ?? indices.premier;
}
