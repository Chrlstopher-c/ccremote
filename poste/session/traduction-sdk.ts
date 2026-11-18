// Responsabilité : traduire un message du Claude Agent SDK (flux `query()`) en événements du fil de Quart et en
// signaux de fin de tour. Pur, sans I/O : seul l'état passé en paramètre change (flux partiel, contexte, erreur).
// Un message inconnu ou incomplet donne une sortie vide, jamais une exception. Pendant de traduction.ts (transcript).
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Evenement } from '../../commun/session.ts';
import { contexteDe, resumerEntree } from './traduction.ts';

const TAILLE_DETAIL = 8_000;
const TAILLE_RESULTAT = 3_000;
const PREFIXE_OUTILS_HARNESS = 'mcp__ccremote__';
const OUTILS_SOUS_AGENT = new Set(['Agent', 'Task']);
const FIL_PRINCIPAL = '';

type Objet = Record<string, unknown>;
type Marque = { agent?: string };
type Assistant = Extract<SDKMessage, { type: 'assistant' }>;
type Utilisateur = Extract<SDKMessage, { type: 'user' }>;
type Flux = Extract<SDKMessage, { type: 'stream_event' }>;
type Resultat = Extract<SDKMessage, { type: 'result' }>;
type Systeme = Extract<SDKMessage, { type: 'system' }>;

export interface EtatTraduction {
  // Id du message en flux, par fil (clé : parent_tool_use_id, '' = principal) : les deltas n'en portent pas.
  readonly messagesEnFlux: Map<string, string>;
  // Tokens relus par le dernier appel modèle du fil principal ; null tant qu'aucun n'a été vu.
  contexte: number | null;
  // Une erreur d'API a déjà été émise pour le tour en cours : le result qui suit ne la répète pas.
  erreurDuTour: boolean;
}

export interface SortieTraduction {
  evenements: Evenement[];
  claudeSessionId?: string;
  finDeTour?: { dureeMs: number; contexte: number; erreur: string | null };
  compaction?: boolean;
}

type Corps = Omit<SortieTraduction, 'claudeSessionId'>;

export function nouvelEtatTraduction(): EtatTraduction {
  return { messagesEnFlux: new Map(), contexte: null, erreurDuTour: false };
}

// L'identifiant de session est lu sur tout message qui le porte (init compris).
export function traduireSdk(msg: SDKMessage, etat: EtatTraduction): SortieTraduction {
  const corps = traduireCorps(msg, etat);
  const claudeSessionId = texteDe(objet(msg)['session_id']);
  return claudeSessionId ? { ...corps, claudeSessionId } : corps;
}

function traduireCorps(msg: SDKMessage, etat: EtatTraduction): Corps {
  switch (msg.type) {
    case 'assistant':
      return { evenements: traduireAssistant(msg, etat) };
    case 'user':
      return { evenements: traduireUtilisateur(msg) };
    case 'stream_event':
      return { evenements: traduireFlux(msg, etat) };
    case 'result':
      return traduireResultat(msg, etat);
    case 'system':
      return traduireSysteme(msg);
    default:
      return { evenements: [] };
  }
}

function traduireAssistant(msg: Assistant, etat: EtatTraduction): Evenement[] {
  const marque = marqueDe(msg.parent_tool_use_id);
  const principal = marque.agent === undefined;
  if (msg.error && principal) {
    etat.erreurDuTour = true;
    const texteErreur = blocsDe(msg.message.content)
      .map((b) => texteDe(b['text']))
      .join(' ')
      .trim();
    return [{ type: 'erreur', message: texteErreur || `erreur de l’API : ${msg.error}` }];
  }
  if (principal) mettreContexte(msg.message, etat);
  return blocsDe(msg.message.content).flatMap((b) => traduireBlocAssistant(b, marque));
}

// Contexte relu au prochain tour = input + cache lu + cache créé du dernier appel du fil principal (cf. traduction.ts).
function mettreContexte(message: unknown, etat: EtatTraduction): void {
  const usage = objet(message)['usage'];
  if (!estObjet(usage)) return;
  const contexte = contexteDe({ type: 'assistant', message: { usage } });
  if (contexte !== null) etat.contexte = contexte;
}

function traduireBlocAssistant(bloc: Objet, marque: Marque): Evenement[] {
  const type = bloc['type'];
  if (type === 'text' && texteDe(bloc['text']).trim()) {
    return [{ type: 'texte', texte: texteDe(bloc['text']), ...marque }];
  }
  if (type === 'thinking' && texteDe(bloc['thinking']).trim()) {
    return [{ type: 'reflexion', texte: texteDe(bloc['thinking']), ...marque }];
  }
  return type === 'tool_use' ? traduireOutil(bloc, marque) : [];
}

// Un appel de sous-agent (Task/Agent) donne aussi un `sous_agent` : le fil l'affiche comme une carte.
function traduireOutil(bloc: Objet, marque: Marque): Evenement[] {
  const nom = texteDe(bloc['name']);
  const id = texteDe(bloc['id']);
  const entree = objet(bloc['input']);
  if (!nom || nom.startsWith(PREFIXE_OUTILS_HARNESS)) return [];
  const outil: Evenement = {
    type: 'outil',
    id,
    nom,
    resume: resumerEntree(nom, entree),
    detail: detailEntree(entree),
    ...marque,
  };
  if (!OUTILS_SOUS_AGENT.has(nom)) return [outil];
  const sousAgent: Evenement = {
    type: 'sous_agent',
    id,
    description: texteDe(entree['description']),
    modele: texteDe(entree['model']),
    genre: texteDe(entree['subagent_type']) || 'general-purpose',
  };
  return [outil, sousAgent];
}

function traduireUtilisateur(msg: Utilisateur): Evenement[] {
  const marque = marqueDe(msg.parent_tool_use_id);
  return blocsDe(msg.message.content)
    .filter((b) => b['type'] === 'tool_result')
    .map((b): Evenement => ({
      type: 'resultat_outil',
      outilId: texteDe(b['tool_use_id']),
      extrait: texteDuResultat(b['content']).slice(0, TAILLE_RESULTAT),
      erreur: b['is_error'] === true,
      ...marque,
    }));
}

function traduireFlux(msg: Flux, etat: EtatTraduction): Evenement[] {
  const fil = texteDe(msg.parent_tool_use_id) || FIL_PRINCIPAL;
  const marque = marqueDe(msg.parent_tool_use_id);
  const evenement = objet(msg.event);
  if (evenement['type'] === 'message_start') {
    etat.messagesEnFlux.set(fil, texteDe(objet(evenement['message'])['id']));
    return [];
  }
  if (evenement['type'] === 'message_stop') {
    etat.messagesEnFlux.delete(fil);
    return [];
  }
  const delta = objet(evenement['delta']);
  if (evenement['type'] !== 'content_block_delta') return [];
  const index = nombreDe(evenement['index']);
  const id = etat.messagesEnFlux.get(fil) || String(index);
  const bloc = `${id}:${index}`;
  if (delta['type'] === 'text_delta') return [{ type: 'flux', bloc, delta: texteDe(delta['text']), ...marque }];
  if (delta['type'] === 'thinking_delta') {
    return [{ type: 'flux', bloc, delta: texteDe(delta['thinking']), genre: 'reflexion', ...marque }];
  }
  return [];
}

function traduireResultat(msg: Resultat, etat: EtatTraduction): Corps {
  const erreur = erreurDuResultat(msg);
  const dureeMs = nombreDe(msg.duration_ms);
  const contexte = etat.contexte ?? 0;
  const evenements: Evenement[] = [];
  if (erreur !== null && !etat.erreurDuTour) evenements.push({ type: 'erreur', message: erreur });
  evenements.push({ type: 'tour_fini', dureeMs, contexte });
  etat.erreurDuTour = false;
  etat.messagesEnFlux.clear();
  return { evenements, finDeTour: { dureeMs, contexte, erreur } };
}

function erreurDuResultat(msg: Resultat): string | null {
  if (msg.subtype === 'success') return msg.is_error ? msg.result || 'erreur' : null;
  return msg.errors?.join(' ') || msg.subtype;
}

function traduireSysteme(msg: Systeme): Corps {
  if (msg.subtype === 'status') {
    return msg.status === 'compacting' ? { evenements: [], compaction: true } : { evenements: [] };
  }
  if (msg.subtype === 'compact_boundary') {
    return { evenements: [evenementCompaction(msg.compact_metadata)], compaction: true };
  }
  return { evenements: [] };
}

function evenementCompaction(meta: unknown): Evenement {
  const m = objet(meta);
  return {
    type: 'compaction',
    avant: nombreDe(m['pre_tokens']),
    apres: nombreDe(m['post_tokens']),
    declencheur: texteDe(m['trigger']),
  };
}

function detailEntree(entree: Objet): string {
  const t = JSON.stringify(entree, null, 1);
  return t.length > TAILLE_DETAIL ? `${t.slice(0, TAILLE_DETAIL)}…` : t;
}

// Contenu d'un résultat : chaîne, ou blocs texte concaténés (comme traduction.ts).
function texteDuResultat(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu;
  return blocsDe(contenu)
    .map((b) => texteDe(b['text']))
    .join('\n');
}

function marqueDe(parent: unknown): Marque {
  const id = texteDe(parent);
  return id ? { agent: id } : {};
}

function blocsDe(contenu: unknown): Objet[] {
  return Array.isArray(contenu) ? contenu.filter(estObjet) : [];
}

function estObjet(v: unknown): v is Objet {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function objet(v: unknown): Objet {
  return estObjet(v) ? v : {};
}

function texteDe(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function nombreDe(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
