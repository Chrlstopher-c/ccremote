// Responsabilité : la recherche dans les transcripts du poste (sessions pas encore ouvertes dans le relais). Lecture
// seule : `grep -r -l -i -F` lancé sans shell pour trouver les fichiers, puis lecture des seuls fichiers trouvés, dans
// un délai borné. Sans grep, repli en lecture JS de tous les transcripts, dans le même délai.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Logger } from 'pino';
import {
  echappementJson,
  extraitAutour,
  IDENTIFIANT_SESSION,
  normaliserEspaces,
  type ResultatTranscript,
} from '../../commun/reste.ts';
import { analyserTranscript } from '../session/decouverte.ts';
import { titreDeContenu } from '../session/titre-transcript.ts';

export const DELAI_RECHERCHE_MS = 10_000;
const PAR_SESSION = 3;

export interface OptionsRecherche {
  /** Dossiers `projects` des configurations Claude du poste (existants ou non). */
  readonly racines: readonly string[];
  readonly journal: Logger;
  /** Binaire de recherche (`grep` par défaut) ; un chemin absent force le repli en lecture JS. */
  readonly grep?: string;
  readonly delaiMs?: number;
}

interface Fichier {
  readonly chemin: string;
  readonly mtime: number;
}

type Occurrence = Pick<ResultatTranscript, 'ts' | 'role' | 'extrait' | 'debut' | 'longueur'>;
type Objet = Record<string, unknown>;
type ProcessusGrep = NonNullable<ReturnType<typeof lancerGrep>>;

/** Les occurrences de `texte` dans les messages de Chris et de Claude, plus récentes d'abord, au plus `limite`. */
export async function rechercherTranscripts(
  texte: string,
  limite: number,
  options: OptionsRecherche,
): Promise<{ resultats: ResultatTranscript[] }> {
  const fin = Date.now() + (options.delaiMs ?? DELAI_RECHERCHE_MS);
  const racines = options.racines.filter((r) => existsSync(r));
  if (racines.length === 0 || normaliserEspaces(texte) === '') return { resultats: [] };
  const candidats = await cheminsCandidats(echappementJson(texte), racines, fin, options);
  const resultats: ResultatTranscript[] = [];
  for (const fichier of recentsDabord(candidats)) {
    if (resultats.length >= limite || Date.now() >= fin) break;
    const max = Math.min(PAR_SESSION, limite - resultats.length);
    resultats.push(...transcriptDu(fichier, texte, max, options.journal));
  }
  return { resultats };
}

// Les fichiers qui contiennent le texte échappé (grep), sinon tous les transcripts (repli JS).
async function cheminsCandidats(
  motif: string,
  racines: readonly string[],
  fin: number,
  options: OptionsRecherche,
): Promise<string[]> {
  const processus = lancerGrep(options.grep ?? 'grep', motif, racines, options.journal);
  if (!processus) return listerJsonl(racines, options.journal);
  return sortieGrep(processus, fin, options.journal);
}

// Tableau d'arguments, jamais de shell : le texte de Chris ne peut pas devenir une commande. Null si grep manque.
function lancerGrep(binaire: string, motif: string, racines: readonly string[], journal: Logger) {
  try {
    return Bun.spawn([binaire, '-r', '-l', '-i', '-F', '--', motif, ...racines], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
  } catch (erreur) {
    journal.warn({ err: erreur }, 'grep indisponible : lecture JS des transcripts');
    return null;
  }
}

// Les chemins trouvés ; au-delà du délai, le processus (lancé ici) est arrêté et ce qui était déjà sorti est gardé.
async function sortieGrep(processus: ProcessusGrep, fin: number, journal: Logger): Promise<string[]> {
  const minuterie = setTimeout(() => processus.kill(), Math.max(0, fin - Date.now()));
  try {
    const sortie = await new Response(processus.stdout).text();
    await processus.exited;
    return sortie.split('\n').filter((l) => l.endsWith('.jsonl'));
  } catch (erreur) {
    journal.warn({ err: erreur }, 'sortie de grep illisible');
    return [];
  } finally {
    clearTimeout(minuterie);
  }
}

function listerJsonl(racines: readonly string[], journal: Logger): string[] {
  return racines.flatMap((racine) => {
    try {
      return readdirSync(racine, { recursive: true, encoding: 'utf8' })
        .filter((nom) => nom.endsWith('.jsonl'))
        .map((nom) => join(racine, nom));
    } catch (erreur) {
      journal.warn({ err: erreur, racine }, 'transcripts illisibles : dossier ignoré');
      return [];
    }
  });
}

// Le plus récent d'abord (date de modification) ; un fichier disparu entre-temps est écarté.
function recentsDabord(chemins: readonly string[]): Fichier[] {
  const fichiers: Fichier[] = [];
  for (const chemin of new Set(chemins)) {
    try {
      fichiers.push({ chemin, mtime: statSync(chemin).mtimeMs });
    } catch {
      continue; // disparu depuis la recherche : rien à lire
    }
  }
  return fichiers.sort((a, b) => b.mtime - a.mtime);
}

// Les occurrences d'un transcript retenu : sessions de Chris seulement (même critère que la liste des découvertes).
function transcriptDu(fichier: Fichier, requete: string, max: number, journal: Logger): ResultatTranscript[] {
  const id = basename(fichier.chemin, '.jsonl');
  if (!IDENTIFIANT_SESSION.test(id) || id.startsWith('agent-')) return [];
  let contenu: string;
  try {
    contenu = readFileSync(fichier.chemin, 'utf8');
  } catch (erreur) {
    journal.warn({ chemin: fichier.chemin, err: erreur }, 'transcript illisible : ignoré');
    return [];
  }
  const analyse = analyserTranscript(contenu);
  const dossier = analyse.cwd;
  if (analyse.sousAgent || !analyse.aMessageDeChris || !dossier) return [];
  const titre = titreDeContenu(contenu, dossier) ?? basename(dossier);
  const tsDefaut = new Date(fichier.mtime).toISOString();
  return occurrencesDu(contenu, requete, max, tsDefaut).map((o) => ({ sessionId: id, dossier, titre, ...o }));
}

// Lignes de la plus récente à la plus ancienne ; s'arrête dès `max` occurrences.
function occurrencesDu(contenu: string, requete: string, max: number, tsDefaut: string): Occurrence[] {
  const lignes = contenu.split('\n');
  const trouvees: Occurrence[] = [];
  for (let i = lignes.length - 1; i >= 0 && trouvees.length < max; i--) {
    const ligne = lignes[i] ?? '';
    if (!ligne.includes('"type":"user"') && !ligne.includes('"type":"assistant"')) continue;
    trouvees.push(...occurrencesDeLigne(ligne, requete, tsDefaut).slice(0, max - trouvees.length));
  }
  return trouvees;
}

function occurrencesDeLigne(ligne: string, requete: string, tsDefaut: string): Occurrence[] {
  const objet = enObjet(parserLigne(ligne));
  if (!objet || objet['isMeta'] === true) return [];
  const role = objet['type'] === 'user' ? 'chris' : objet['type'] === 'assistant' ? 'claude' : null;
  if (!role) return [];
  const ts = typeof objet['timestamp'] === 'string' ? objet['timestamp'] : tsDefaut;
  return textesDu(objet).flatMap((t) => {
    const e = extraitAutour(t, requete);
    return e ? [{ ts, role, extrait: e.extrait, debut: e.debut, longueur: e.longueur }] : [];
  });
}

// Seuls les blocs de texte comptent : pas les résultats d'outils, ni les appels d'outils.
function textesDu(objet: Objet): string[] {
  const contenu = enObjet(objet['message'])?.['content'];
  if (typeof contenu === 'string') return [contenu];
  if (!Array.isArray(contenu)) return [];
  return contenu.flatMap((b: unknown) => {
    const bloc = enObjet(b);
    return bloc?.['type'] === 'text' && typeof bloc['text'] === 'string' ? [bloc['text']] : [];
  });
}

// Une ligne tronquée (écriture en cours) n'est pas un message : elle est sautée sans bruit.
function parserLigne(ligne: string): unknown {
  try {
    return JSON.parse(ligne);
  } catch {
    return null;
  }
}

// Valeur lue depuis du JSON : le cast ne sert qu'à lire ses champs par clé, après vérification d'objet.
function enObjet(v: unknown): Objet | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objet) : null;
}
