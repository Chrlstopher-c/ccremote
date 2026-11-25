// Responsabilité : l'état réel d'une conversation d'après la fin de son transcript — dernière activité (horodatage de
// la dernière ligne), modèle, mode de permission (`permissionMode` des messages de Chris, `auto` compris), contexte du
// dernier message assistant, et si un tour est en cours. Sert à recaler une fiche sur la vérité, pas sur une valeur
// par défaut.
import { statSync } from 'node:fs';
import type { Logger } from 'pino';
import type { ModeSession } from '../../commun/session.ts';
import type { Ligne } from './traduction.ts';
import { travailEnCours } from './traduction.ts';
import { lireFin } from './modele-transcript.ts';

export interface EtatTranscript {
  readonly majLe: string | null;
  readonly modele: string | null;
  readonly modeleLe: string | null; // horodatage du message assistant qui porte ce modèle
  readonly versionClaude?: string | null; // version de Claude Code qui a écrit la dernière ligne datée
  readonly mode: ModeSession | null;
  readonly contexte: number | null;
  readonly travailDernier: boolean | null; // dernier signal du tour : true (en cours), false (fini), null (inconnu)
  readonly ecritLe: number; // mtime du fichier (ms), 0 si inconnu
}

type Objet = Record<string, unknown>;
const MODES: ReadonlySet<string> = new Set(['bypassPermissions', 'default', 'acceptEdits', 'plan', 'auto']);
const RECENTE_MS = 120_000; // un transcript écrit il y a moins de deux minutes sans fin de tour : tour en cours

const enObjet = (v: unknown): Objet | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objet) : null;
const nombre = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parser(ligne: string): Objet | null {
  try {
    return enObjet(JSON.parse(ligne));
  } catch {
    return null; // ligne tronquée au début de la fenêtre : ignorée
  }
}

// Contexte d'un message assistant : entrée + cache lu + cache écrit (même calcul que la parité).
function contexteDe(message: Objet): number | null {
  const usage = enObjet(message['usage']);
  if (!usage) return null;
  return (
    nombre(usage['input_tokens']) +
    nombre(usage['cache_read_input_tokens']) +
    nombre(usage['cache_creation_input_tokens'])
  );
}

interface Indices {
  majLe: string | null;
  modele: string | null;
  modeleLe: string | null;
  versionClaude: string | null;
  mode: ModeSession | null;
  contexte: number | null;
  travail: boolean | null;
  travailVu: boolean;
}

// Une ligne de la fin vers le début : chaque valeur est prise à sa dernière occurrence. Vrai quand tout est trouvé.
function prendre(ligne: string, i: Indices): boolean {
  const objet = parser(ligne);
  if (!objet) return complet(i);
  if (i.majLe === null && typeof objet['timestamp'] === 'string') i.majLe = objet['timestamp'];
  if (i.versionClaude === null && typeof objet['version'] === 'string' && objet['version'] !== '') {
    i.versionClaude = objet['version'];
  }
  const message = enObjet(objet['message']);
  if (message && objet['type'] === 'assistant') {
    const modele = message['model'];
    if (i.modele === null && typeof modele === 'string' && modele !== '' && !modele.startsWith('<')) {
      i.modele = modele;
      i.modeleLe = typeof objet['timestamp'] === 'string' ? objet['timestamp'] : null;
    }
    if (i.contexte === null) i.contexte = contexteDe(message);
  }
  const mode = objet['permissionMode'];
  if (i.mode === null && typeof mode === 'string' && MODES.has(mode)) i.mode = mode as ModeSession;
  if (!i.travailVu) {
    // La ligne est celle du transcript ; travailEnCours ne lit que son type et son message.
    const signal = travailEnCours(objet as Ligne);
    if (signal !== null) {
      i.travail = signal;
      i.travailVu = true;
    }
  }
  return complet(i);
}

function complet(i: Indices): boolean {
  return i.majLe !== null && i.modele !== null && i.mode !== null && i.contexte !== null && i.travailVu;
}

function vide(): Indices {
  return {
    majLe: null,
    modele: null,
    modeleLe: null,
    versionClaude: null,
    mode: null,
    contexte: null,
    travail: null,
    travailVu: false,
  };
}

function absent(erreur: unknown): boolean {
  return typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'ENOENT';
}

function mtimeDe(chemin: string): number {
  try {
    return statSync(chemin).mtimeMs;
  } catch {
    return 0;
  }
}

/** L'état réel d'une conversation d'après la fin de son transcript ; null si le fichier est absent ou illisible. */
export function etatDuTranscript(chemin: string, journal: Logger): EtatTranscript | null {
  try {
    const lignes = lireFin(chemin).split('\n');
    const i = vide();
    for (let k = lignes.length - 1; k >= 0 && !prendre(lignes[k] ?? '', i); k--) continue;
    return {
      majLe: i.majLe,
      modele: i.modele,
      modeleLe: i.modeleLe,
      ...(i.versionClaude ? { versionClaude: i.versionClaude } : {}),
      mode: i.mode,
      contexte: i.contexte,
      travailDernier: i.travail,
      ecritLe: mtimeDe(chemin),
    };
  } catch (erreur) {
    if (absent(erreur)) return null; // pas encore de transcript : rien à signaler à chaque passage
    journal.warn({ err: erreur, chemin }, 'état du transcript non lu');
    return null;
  }
}

/** Un tour est en cours : le dernier signal dit « en cours », ou rien n'a dit « fini » et le fichier bouge encore. */
export function tourEnCours(etat: EtatTranscript, maintenant: number): boolean {
  if (etat.travailDernier !== null) return etat.travailDernier;
  return maintenant - etat.ecritLe < RECENTE_MS;
}
