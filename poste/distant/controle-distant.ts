// Responsabilité : les événements de contrôle échangés avec une session claude.ai — messages et réglages sortants,
// demandes de permission et fins de demande entrantes. Pur, sans I/O.
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Reglage } from '../session/session-poste.ts';
import { MODELE_PAR_DEFAUT } from '../session/reglages-sdk.ts';
import { EffortSession } from '../../commun/session.ts';
import { objet, tableau, texte } from '../comptes/valeurs.ts';

export interface DemandeEntrante {
  readonly requestId: string;
  readonly outil: string;
  readonly entree: Record<string, unknown>;
  readonly suggestions: PermissionUpdate[];
}

export function messageUtilisateur(
  idSession: string,
  contenu: string | readonly unknown[],
  uuid: string,
  priorite?: 'next' | 'later',
): Record<string, unknown> {
  return {
    uuid,
    session_id: idSession,
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: contenu },
    ...(priorite ? { priority: priorite } : {}),
  };
}

/** Une requête de contrôle : son identifiant suit le sous-type (`interrupt-<uuid>`), comme le CLI. */
export function requeteControle(uuid: string, requete: Record<string, unknown>): Record<string, unknown> {
  return {
    uuid,
    type: 'control_request',
    request_id: `${texte(requete['subtype']) ?? 'requete'}-${uuid}`,
    request: requete,
  };
}

export function reponseControle(uuid: string, requestId: string, decision: unknown): Record<string, unknown> {
  return {
    uuid,
    type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response: decision },
  };
}

/** Le réglage de Chris en requête de contrôle du SDK (noms du SDK), ou null si claude.ai ne le prend pas. */
export function requeteReglage(r: Reglage): Record<string, unknown> | null {
  if (r.kind === 'mode') return { subtype: 'set_permission_mode', mode: r.mode };
  if (r.kind === 'modele') {
    return { subtype: 'set_model', model: r.modele === MODELE_PAR_DEFAUT ? 'default' : r.modele };
  }
  if (r.kind === 'effort') return { subtype: 'apply_flag_settings', settings: { effortLevel: r.effort } };
  if (r.kind === 'renommer') return { subtype: 'rename_session', title: r.titre };
  return null;
}

// Commandes « / » sans requête de contrôle dans le SDK : envoyées comme texte, elles ne s'exécutent pas.
const SANS_REQUETE = new Set(['compact', 'clear', 'reset', 'new']);
const INDISPONIBLE =
  'commande non disponible pour une session tenue par Claude Desktop : ' +
  'la taper dans Desktop, ou migrer la session vers Lanterne';

export type CommandeTapee = { readonly reglage: Reglage } | { readonly refus: string };

/**
 * Une commande « / » tapée dans Lanterne, traduite en réglage (requête de contrôle) ou refusée avec sa raison.
 * Null pour un message ordinaire, ou pour une commande que le poste ne traduit pas (envoyée telle quelle).
 */
export function traduireCommande(texte: string): CommandeTapee | null {
  const m = /^\/([a-z]+)(?:\s+(.*))?$/i.exec(texte.trim());
  if (!m) return null;
  const nom = (m[1] ?? '').toLowerCase();
  const arg = (m[2] ?? '').trim();
  if (SANS_REQUETE.has(nom)) {
    return { refus: `/${nom} : ${INDISPONIBLE}` };
  }
  if (nom === 'model') {
    if (arg === '') return { refus: '/model : indiquer le modèle, par exemple /model opus' };
    return { reglage: { kind: 'modele', modele: arg === 'default' ? MODELE_PAR_DEFAUT : arg } };
  }
  if (nom === 'effort') {
    if (arg === 'auto') return { reglage: { kind: 'effort', effort: null } };
    const niveau = EffortSession.safeParse(arg);
    if (niveau.success) return { reglage: { kind: 'effort', effort: niveau.data } };
    return { refus: `/effort : niveau inconnu « ${arg} » (low, medium, high, xhigh, max ou auto)` };
  }
  return null;
}

// Une mise à jour de permission est un objet typé par le SDK ; sa forme est vérifiée ici, le SDK la rejette sinon.
const estMiseAJour = (v: unknown): v is PermissionUpdate => texte(objet(v)['type']) !== null;

/** La demande de permission (ou de question) d'un message entrant, ou null pour tout autre message. */
export function demandeEntrante(payload: unknown): DemandeEntrante | null {
  const o = objet(payload);
  if (texte(o['type']) !== 'control_request') return null;
  const requete = objet(o['request']);
  if (texte(requete['subtype']) !== 'can_use_tool') return null;
  const requestId = texte(o['request_id']);
  const outil = texte(requete['tool_name']);
  if (requestId === null || outil === null) return null;
  const suggestions = tableau(requete['permission_suggestions']).filter(estMiseAJour);
  return { requestId, outil, entree: objet(requete['input']), suggestions };
}

/** L'identifiant de la demande qu'un message désigne comme close (répondue ailleurs, annulée), sinon null. */
export function demandeCloseePar(payload: unknown): string | null {
  const o = objet(payload);
  const type = texte(o['type']);
  if (type !== 'control_response' && type !== 'control_cancel_request') return null;
  return texte(o['request_id']) ?? texte(objet(o['response'])['request_id']);
}

/** Le contenu d'un message avec ses images jointes (blocs image en base64, puis le texte). */
export function contenuAvecImages(
  texteMessage: string,
  images: readonly { mime: string; base64: string }[],
): readonly unknown[] {
  const blocs: unknown[] = images.map((i) => ({
    type: 'image',
    source: { type: 'base64', media_type: i.mime, data: i.base64 },
  }));
  if (texteMessage.trim() !== '') blocs.push({ type: 'text', text: texteMessage });
  return blocs;
}
