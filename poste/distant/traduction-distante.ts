// Responsabilité : traduire le fil d'une session claude.ai (payloads du Claude Agent SDK) en événements du fil de
// Quart, dans l'ordre d'arrivée. Pur hors l'état de traduction et le stockeur de pièces passés en paramètre.
// Un payload inconnu est ignoré ; un bloc inconnu d'un message de Chris devient une pastille, jamais une disparition.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { type EtatTraduction, traduireSdk } from '../session/traduction-sdk.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import { estTypeImage, imagesDeContenu } from '../presentation/images.ts';
import { objet } from '../comptes/valeurs.ts';
import type { EvenementBrut } from './donnees.ts';
import type { Evenement } from '../../commun/session.ts';
import { sansEnteteChris } from '../../commun/entete-chris.ts';
import { estMarqueInterruption } from '../session/traduction.ts';

/** Pièce d'un message (image, document) à stocker : base64 + type. */
export interface PieceBrute {
  readonly mime: string;
  readonly base64: string;
}

/** Stocke une pièce et rend l'événement qui la présente (image ou fichier joint) ; null si elle est écartée. */
export interface StockeurPieces {
  image(piece: PieceBrute, rang: number, origine: 'outil' | 'utilisateur'): Evenement | null;
  document(piece: PieceBrute, rang: number, nom: string | null): Evenement | null;
}

type Objet = Record<string, unknown>;

/** Un événement compte pour la limite d'un historique s'il est un message du SDK autre qu'un `system`. */
export function estAffichable(brute: EvenementBrut): boolean {
  return estMessageSdk(brute.payload) && objet(brute.payload)['type'] !== 'system';
}

/** Un payload est un message du SDK s'il porte un type textuel ; le reste n'est pas traduit. */
export function estMessageSdk(v: unknown): v is SDKMessage {
  return typeof objet(v)['type'] === 'string';
}

/** Les événements d'un lot, dans l'ordre donné (du plus ancien au plus récent), horodatés par leur création. */
export function traduireLot(
  brutes: readonly EvenementBrut[],
  etat: EtatTraduction,
  pieces?: StockeurPieces,
): EvenementHorodate[] {
  return brutes.flatMap((brute) => {
    if (!estMessageSdk(brute.payload)) return [];
    const sortie = traduireSdk(brute.payload, etat);
    const evenements = [
      ...messageUtilisateur(brute.payload, pieces),
      ...sortie.evenements,
      ...imagesDOutils(brute.payload, pieces),
    ];
    return evenements.map((evt) => ({ ts: brute.creeLe ?? '', evt }));
  });
}

// Message de Chris (tapé sur Desktop, claude.ai ou par le relais) : texte, images, documents, pastille pour le reste.
// Exclus : retours d'outils, messages méta ou synthétiques, fils de sous-agents, tours non humains (notifications).
function messageUtilisateur(payload: SDKMessage, pieces?: StockeurPieces): Evenement[] {
  const p = objet(payload);
  if (p['type'] !== 'user' || p['isMeta'] === true || p['isSynthetic'] === true) return [];
  if (typeof p['parent_tool_use_id'] === 'string' && p['parent_tool_use_id'] !== '') return [];
  const contenu = objet(p['message'])['content'];
  const origine = objet(p['origin'])['kind'];
  const blocs = typeof contenu === 'string' ? [{ type: 'text', text: contenu }] : blocsDe(contenu);
  const brut = blocs
    .filter((b) => b['type'] === 'text')
    .map((b) => String(b['text'] ?? ''))
    .join('\n');
  if (origine === 'task-notification' || brut.trimStart().startsWith('<task-notification>')) {
    return notificationDeTache(brut);
  }
  if (origine !== undefined && origine !== 'human') return [];
  if (blocs.some((b) => b['type'] === 'tool_result')) return [];
  const uuid = typeof p['uuid'] === 'string' ? { uuid: p['uuid'] } : {};
  const { textes, joints } = lireBlocs(blocs, pieces);
  const texte = sansEnteteChris(textes.join('\n').trim()).trim();
  const sansMessage = texte === '' || estMarqueInterruption(texte);
  const message: Evenement[] = sansMessage ? [] : [{ type: 'message', texte, ...uuid }];
  return [...message, ...joints];
}

function lireBlocs(blocs: readonly Objet[], pieces?: StockeurPieces): { textes: string[]; joints: Evenement[] } {
  const textes: string[] = [];
  const joints: Evenement[] = [];
  let rangImage = 0;
  let rangDocument = 0;
  for (const b of blocs) {
    const type = typeof b['type'] === 'string' ? b['type'] : 'inconnu';
    if (type === 'text') {
      const t = texteDeChris(String(b['text'] ?? ''));
      if (t) textes.push(t);
      continue;
    }
    const piece = pieceDe(b);
    const evt =
      piece && type === 'image' && estTypeImage(piece.mime)
        ? pieces?.image(piece, rangImage++, 'utilisateur')
        : piece && type === 'document'
          ? pieces?.document(piece, rangDocument++, nomDocument(b))
          : null;
    if (evt) joints.push(evt);
    else textes.push(pastille(type, b));
  }
  return { textes, joints };
}

// Les rappels système et sorties locales ne sont pas du texte de Chris ; une commande tapée garde son nom.
function texteDeChris(brut: string): string {
  const t = brut.trim();
  if (/^<(local-command|system-reminder|command-message)/.test(t)) return '';
  const commande = t.match(/<command-name>([^<]*)<\/command-name>/);
  if (!commande) return t;
  return `${commande[1]} ${t.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? ''}`.trim();
}

function pieceDe(b: Objet): PieceBrute | null {
  const source = objet(b['source']);
  const mime = source['media_type'];
  if (typeof mime !== 'string') return null;
  if (source['type'] === 'base64' && typeof source['data'] === 'string') return { mime, base64: source['data'] };
  if (source['type'] === 'text' && typeof source['data'] === 'string') {
    return { mime, base64: Buffer.from(source['data'], 'utf8').toString('base64') };
  }
  return null;
}

function nomDocument(b: Objet): string | null {
  const titre = b['title'];
  return typeof titre === 'string' && titre.trim() !== '' ? titre.trim() : null;
}

// Pastille neutre : ce qui n'a pas pu être présenté reste visible dans la bulle, par son genre.
function pastille(type: string, b: Objet): string {
  if (type === 'image') return '[Image]';
  if (type === 'document') return `[Document${nomDocument(b) ? ` : ${nomDocument(b)}` : ''}]`;
  return `[Pièce jointe : ${type}]`;
}

// Fin d'une tâche de fond, remise en tour utilisateur : elle complète l'outil lancé, jamais une bulle de Chris.
function notificationDeTache(prompt: string): Evenement[] {
  if (!prompt.includes('<task-notification>')) return [];
  const champ = (nom: string): string => prompt.match(new RegExp(`<${nom}>([\\s\\S]*?)</${nom}>`))?.[1]?.trim() ?? '';
  const outilId = champ('tool-use-id');
  if (!outilId) return [];
  const statut = champ('status');
  return [{ type: 'resultat_outil', outilId, extrait: champ('summary') || 'terminé', erreur: statut !== 'completed' }];
}

// Images rendues par un outil (lecture d'une capture, Read d'un PNG…) : présentées sous l'outil, comme au poste.
function imagesDOutils(payload: SDKMessage, pieces?: StockeurPieces): Evenement[] {
  const p = objet(payload);
  if (!pieces || p['type'] !== 'user') return [];
  const blocs = blocsDe(objet(p['message'])['content']).filter((b) => b['type'] === 'tool_result');
  if (blocs.length === 0) return [];
  const agent = typeof p['parent_tool_use_id'] === 'string' && p['parent_tool_use_id'] ? p['parent_tool_use_id'] : null;
  return imagesDeContenu(blocs).flatMap((image, rang) => {
    const evt = pieces.image(image, rang, 'outil');
    return evt ? [agent && evt.type === 'image' ? { ...evt, agent } : evt] : [];
  });
}

function blocsDe(v: unknown): Objet[] {
  return Array.isArray(v) ? v.filter((b): b is Objet => typeof b === 'object' && b !== null && !Array.isArray(b)) : [];
}
