// Responsabilité : traduire un message du Claude Agent SDK (flux `query()`) en événements du fil de Quart et en
// signaux de fin de tour. Pur, sans I/O : seul l'état passé en paramètre change (flux partiel, contexte, erreur).
// Un message inconnu ou incomplet donne une sortie vide, jamais une exception. Pendant de traduction.ts (transcript).
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Evenement } from '../../commun/session.ts';
import type { LimiteSdk } from '../../commun/comptes.ts';
import { contexteDe, resumerEntree } from './traduction.ts';

const TAILLE_DETAIL = 8_000;
const TAILLE_RESULTAT = 3_000;
const PREFIXE_OUTILS_HARNESS = 'mcp__ccremote__';
// Outils de présentation : leur effet arrive par les événements fichier, artefact, widget ; l'appel n'a pas de carte.
const PREFIXE_PRESENTATION = 'mcp__lanterne__';
const OUTILS_SOUS_AGENT = new Set(['Agent', 'Task']);
// Liste de tâches du SDK (CLAUDE_CODE_ENABLE_TODO_TOOLS) : pas de carte d'outil, la liste du fil la remplace.
const OUTILS_TACHES = new Set(['TaskCreate', 'TaskUpdate']);
const FIL_PRINCIPAL = '';

type Objet = Record<string, unknown>;
type Marque = { agent?: string };
type Assistant = Extract<SDKMessage, { type: 'assistant' }>;
type Utilisateur = Extract<SDKMessage, { type: 'user' }>;
type Flux = Extract<SDKMessage, { type: 'stream_event' }>;
type Resultat = Extract<SDKMessage, { type: 'result' }>;
type Systeme = Extract<SDKMessage, { type: 'system' }>;
type EtatTache = 'attente' | 'en_cours' | 'fait';
interface Tache {
  id: string;
  contenu: string;
  etat: EtatTache;
}

export interface EtatTraduction {
  // Id du message en flux, par fil (clé : parent_tool_use_id, '' = principal) : les deltas n'en portent pas.
  readonly messagesEnFlux: Map<string, string>;
  // Tokens relus par le dernier appel modèle du fil principal ; null tant qu'aucun n'a été vu.
  contexte: number | null;
  // Une erreur d'API a déjà été émise pour le tour en cours : le result qui suit ne la répète pas.
  erreurDuTour: boolean;
  // Appels des outils de présentation : leurs résultats sont masqués comme leurs appels.
  readonly outilsPresentation: Set<string>;
  // Dernière entrée assistant du fil principal pendant le tour : son uuid désigne la réponse (dupliquer, épingler).
  dernierUuid: string | null;
  // Liste de tâches (TaskCreate/TaskUpdate) du fil principal, par ordre de création ; vit toute la session.
  readonly taches: Tache[];
  // TaskCreate en attente de son résultat (id de l'appel → sujet) : l'id de la tâche vient du résultat.
  readonly creations: Map<string, string>;
  // Appels TaskCreate/TaskUpdate : leurs résultats sont masqués comme leurs appels.
  readonly outilsTaches: Set<string>;
  // Dernier numéro de tâche vu : repli (numérotation de Claude Code) si le résultat ne porte pas d'id.
  dernierNumeroTache: number;
}

export interface SortieTraduction {
  evenements: Evenement[];
  claudeSessionId?: string;
  finDeTour?: { dureeMs: number; contexte: number; erreur: string | null };
  compaction?: boolean;
  limite?: LimiteSdk;
}

type Corps = Omit<SortieTraduction, 'claudeSessionId'>;

export function nouvelEtatTraduction(): EtatTraduction {
  return {
    messagesEnFlux: new Map(),
    contexte: null,
    erreurDuTour: false,
    outilsPresentation: new Set(),
    dernierUuid: null,
    taches: [],
    creations: new Map(),
    outilsTaches: new Set(),
    dernierNumeroTache: 0,
  };
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
      return { evenements: traduireUtilisateur(msg, etat) };
    case 'stream_event':
      return { evenements: traduireFlux(msg, etat) };
    case 'rate_limit_event': {
      const limite = limiteDe(objet(msg)['rate_limit_info']);
      return limite ? { evenements: [], limite } : { evenements: [] };
    }
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
  if (principal && msg.uuid) etat.dernierUuid = msg.uuid;
  const evenements = blocsDe(msg.message.content).flatMap((b) => traduireBlocAssistant(b, marque, etat));
  return principal ? evenements.map((evt) => (evt.type === 'texte' ? { ...evt, uuid: msg.uuid } : evt)) : evenements;
}

// Contexte relu au prochain tour = input + cache lu + cache créé du dernier appel du fil principal (cf. traduction.ts).
function mettreContexte(message: unknown, etat: EtatTraduction): void {
  const usage = objet(message)['usage'];
  if (!estObjet(usage)) return;
  const contexte = contexteDe({ type: 'assistant', message: { usage } });
  if (contexte !== null) etat.contexte = contexte;
}

function traduireBlocAssistant(bloc: Objet, marque: Marque, etat: EtatTraduction): Evenement[] {
  const type = bloc['type'];
  if (type === 'text' && texteDe(bloc['text']).trim()) {
    return [{ type: 'texte', texte: texteDe(bloc['text']), ...marque }];
  }
  if (type === 'thinking' && texteDe(bloc['thinking']).trim()) {
    return [{ type: 'reflexion', texte: texteDe(bloc['thinking']), ...marque }];
  }
  return type === 'tool_use' ? traduireOutil(bloc, marque, etat) : [];
}

// Un appel de sous-agent (Task/Agent) donne aussi un `sous_agent` : le fil l'affiche comme une carte.
function traduireOutil(bloc: Objet, marque: Marque, etat: EtatTraduction): Evenement[] {
  const nom = texteDe(bloc['name']);
  const id = texteDe(bloc['id']);
  const entree = objet(bloc['input']);
  if (nom.startsWith(PREFIXE_PRESENTATION)) etat.outilsPresentation.add(id);
  if (!nom || nom.startsWith(PREFIXE_OUTILS_HARNESS) || nom.startsWith(PREFIXE_PRESENTATION)) return [];
  if (nom === 'TodoWrite' && marque.agent === undefined) return [{ type: 'taches', taches: tachesDe(entree['todos']) }];
  if (OUTILS_TACHES.has(nom) && marque.agent === undefined) return traduireTache(nom, id, entree, etat);
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

function traduireUtilisateur(msg: Utilisateur, etat: EtatTraduction): Evenement[] {
  const marque = marqueDe(msg.parent_tool_use_id);
  return blocsDe(msg.message.content).flatMap((b): Evenement[] => {
    if (b['type'] !== 'tool_result') return [];
    const outilId = texteDe(b['tool_use_id']);
    if (etat.outilsPresentation.has(outilId)) return [];
    if (etat.outilsTaches.has(outilId)) return resultatTache(outilId, b, etat);
    return [
      {
        type: 'resultat_outil',
        outilId,
        extrait: texteDuResultat(b['content']).slice(0, TAILLE_RESULTAT),
        erreur: b['is_error'] === true,
        ...marque,
      },
    ];
  });
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
  const uuid = etat.dernierUuid ? { uuid: etat.dernierUuid } : {};
  evenements.push({ type: 'tour_fini', dureeMs, contexte, ...jetonsDuTour(msg), ...uuid });
  etat.erreurDuTour = false;
  etat.dernierUuid = null;
  etat.messagesEnFlux.clear();
  return { evenements, finDeTour: { dureeMs, contexte, erreur } };
}

// Jetons du tour, totalisés par le SDK : entrée = tout ce qui a été lu (cache compris), sortie = ce qui a été généré.
function jetonsDuTour(msg: Resultat): { entree: number; sortie: number } {
  const u = objet(objet(msg)['usage']);
  const entree = nombreDe(u['input_tokens']) + nombreDe(u['cache_read_input_tokens']);
  return { entree: entree + nombreDe(u['cache_creation_input_tokens']), sortie: nombreDe(u['output_tokens']) };
}

// `utilization` du SDK : fraction 0-1 (les en-têtes de quota le sont) ; une valeur au-dessus de 1 est lue en pourcentage.
// Non documenté par le SDK : à vérifier sur une vraie limite. Seules les fenêtres session (5 h) et semaine comptent.
export function limiteDe(info: unknown): LimiteSdk | null {
  const r = objet(info);
  const type = r['rateLimitType'];
  const genre = type === 'five_hour' ? 'session' : type === 'seven_day' ? 'semaine' : null;
  const u = nombreOuNull(r['utilization']);
  if (genre === null || u === null) return null;
  const pourcent = u <= 1 ? u * 100 : u;
  const fin = nombreOuNull(r['resetsAt']);
  const reinitialiseLe = fin === null ? null : new Date(fin < 1e12 ? fin * 1000 : fin).toISOString();
  return { genre, fenetre: { libelle: genre === 'session' ? 'Session (5 h)' : 'Semaine', pourcent, reinitialiseLe } };
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

function nombreOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Liste de tâches de TodoWrite (statuts du SDK → états du fil). Entrée inconnue : liste vide, jamais d'exception.
function tachesDe(brut: unknown): { contenu: string; etat: 'attente' | 'en_cours' | 'fait' }[] {
  if (!Array.isArray(brut)) return [];
  return brut.flatMap((t) => {
    const tache = objet(t);
    const contenu = texteDe(tache['content']).trim();
    if (contenu === '') return [];
    const etat = tache['status'] === 'completed' ? 'fait' : tache['status'] === 'in_progress' ? 'en_cours' : 'attente';
    return [{ contenu, etat }];
  });
}

// TaskCreate : le sujet attend son résultat, qui porte l'id de la tâche. TaskUpdate : effet immédiat sur la liste.
function traduireTache(nom: string, id: string, entree: Objet, etat: EtatTraduction): Evenement[] {
  etat.outilsTaches.add(id);
  if (nom === 'TaskCreate') {
    const sujet = texteDe(entree['subject']).trim();
    if (sujet) etat.creations.set(id, sujet);
    return [];
  }
  return miseAJourTache(entree, etat) ? [evenementTaches(etat)] : [];
}

function resultatTache(outilId: string, bloc: Objet, etat: EtatTraduction): Evenement[] {
  const sujet = etat.creations.get(outilId);
  if (sujet === undefined) return [];
  etat.creations.delete(outilId);
  if (bloc['is_error'] === true) return [];
  const id = identifiantDeCreation(bloc['content']) ?? String(++etat.dernierNumeroTache);
  etat.dernierNumeroTache = Math.max(etat.dernierNumeroTache, Number(id) || 0);
  etat.taches.push({ id, contenu: sujet, etat: 'attente' });
  return [evenementTaches(etat)];
}

// Applique un TaskUpdate (statut, sujet, suppression) ; vrai si la liste a changé.
function miseAJourTache(entree: Objet, etat: EtatTraduction): boolean {
  const index = etat.taches.findIndex((t) => t.id === texteDe(entree['taskId']));
  const tache = etat.taches[index];
  if (!tache) return false;
  const statut = texteDe(entree['status']);
  if (statut === 'deleted') {
    etat.taches.splice(index, 1);
    return true;
  }
  const etatNouveau = etatDeStatut(statut);
  const sujet = texteDe(entree['subject']).trim();
  if (sujet) tache.contenu = sujet;
  if (etatNouveau) tache.etat = etatNouveau;
  return true;
}

function etatDeStatut(statut: string): EtatTache | null {
  if (statut === 'completed') return 'fait';
  if (statut === 'in_progress') return 'en_cours';
  if (statut === 'pending') return 'attente';
  return null;
}

// Id d'une tâche créée : champ id d'un JSON, ou « #n » du texte de résultat. Absent : null (repli sur la numérotation).
function identifiantDeCreation(contenu: unknown): string | null {
  const texte = texteDuResultat(contenu);
  const trouve = /#(\d+)\b/.exec(texte) ?? /"id"\s*:\s*"?([\w-]+)"?/.exec(texte);
  return trouve?.[1] ?? null;
}

function evenementTaches(etat: EtatTraduction): Evenement {
  return { type: 'taches', taches: etat.taches.map((t) => ({ contenu: t.contenu, etat: t.etat })) };
}
