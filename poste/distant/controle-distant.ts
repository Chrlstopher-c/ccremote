// Responsabilité : les événements de contrôle échangés avec une session claude.ai — messages et réglages sortants,
// demandes de permission et fins de demande entrantes. Pur, sans I/O.
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Reglage } from '../session/session-poste.ts';
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
): Record<string, unknown> {
  return {
    uuid,
    session_id: idSession,
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: contenu },
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
  if (r.kind === 'modele') return { subtype: 'set_model', model: r.modele };
  if (r.kind === 'renommer') return { subtype: 'rename_session', title: r.titre };
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
