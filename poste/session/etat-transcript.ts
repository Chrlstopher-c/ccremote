// Responsabilité : l'état réel d'une conversation d'après la fin de son transcript — dernière activité (horodatage de
// la dernière ligne), modèle, mode de permission (`permissionMode` des messages de Chris, `auto` compris), contexte du
// dernier message assistant. Sert à recaler une fiche sur la vérité au lieu d'une valeur par défaut.
import type { Logger } from 'pino';
import type { ModeSession } from '../../commun/session.ts';
import { lireFin } from './modele-transcript.ts';

export interface EtatTranscript {
  readonly majLe: string | null;
  readonly modele: string | null;
  readonly mode: ModeSession | null;
  readonly contexte: number | null;
}

type Objet = Record<string, unknown>;
const MODES: ReadonlySet<string> = new Set(['bypassPermissions', 'default', 'acceptEdits', 'plan', 'auto']);

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
  mode: ModeSession | null;
  contexte: number | null;
}

function vide(): Indices {
  return { majLe: null, modele: null, mode: null, contexte: null };
}

// Lit une ligne de la fin vers le début : chaque valeur est prise à sa dernière occurrence. Vrai quand tout est trouvé.
function prendre(ligne: string, i: Indices): boolean {
  const objet = parser(ligne);
  if (!objet) return complet(i);
  if (i.majLe === null && typeof objet['timestamp'] === 'string') i.majLe = objet['timestamp'];
  const message = enObjet(objet['message']);
  if (message && objet['type'] === 'assistant') {
    const modele = message['model'];
    if (i.modele === null && typeof modele === 'string' && modele !== '' && !modele.startsWith('<')) i.modele = modele;
    if (i.contexte === null) i.contexte = contexteDe(message);
  }
  const mode = objet['permissionMode'];
  if (i.mode === null && typeof mode === 'string' && MODES.has(mode)) i.mode = mode as ModeSession;
  return complet(i);
}

function complet(i: Indices): boolean {
  return i.majLe !== null && i.modele !== null && i.mode !== null && i.contexte !== null;
}

/** L'état réel d'une conversation d'après la fin de son transcript ; null si le fichier est absent ou illisible. */
export function etatDuTranscript(chemin: string, journal: Logger): EtatTranscript | null {
  try {
    const lignes = lireFin(chemin).split('\n');
    const i = vide();
    for (let k = lignes.length - 1; k >= 0 && !prendre(lignes[k] ?? '', i); k--) continue;
    return { ...i };
  } catch (erreur) {
    journal.warn({ err: erreur, chemin }, 'état du transcript non lu');
    return null;
  }
}
