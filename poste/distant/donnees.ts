// Responsabilité : lire sans lever d'exception les sessions et les événements renvoyés par l'API claude.ai (liste
// des sessions, fil d'une session). Pur : une valeur absente ou d'un autre type donne null ou une valeur neutre.
import { booleen, nombre, objet, tableau, texte } from '../comptes/valeurs.ts';

export interface SessionBrute {
  readonly id: string;
  readonly titre: string | null;
  readonly bridge: boolean; // environment_kind === 'bridge' : Remote Control
  readonly active: boolean; // status === 'active' (non archivée)
  readonly connectee: boolean; // connection_status === 'connected'
  readonly travail: string | null; // worker_status : running, idle, requires_action
  readonly dernierEvenement: string | null;
  readonly creeLe: string | null;
  readonly majLe: string | null;
  readonly nonLue: boolean;
  readonly modele: string | null;
  readonly effort: string | null;
  readonly contexte: { readonly tokens: number; readonly max: number } | null;
}

export interface EvenementBrut {
  readonly id: string; // event_id : identifiant stable, sert à ne pas émettre deux fois un événement
  readonly creeLe: string | null;
  readonly payload: unknown; // message du Claude Agent SDK, à traduire par traduireSdk
}

export interface PageEvenements {
  readonly evenements: EvenementBrut[];
  readonly suivant: string | null;
}

/** Une session de la liste ; null si elle n'a pas d'identifiant. */
export function lireSession(v: unknown): SessionBrute | null {
  const o = objet(v);
  const id = texte(o['id']);
  if (id === null) return null;
  const meta = objet(o['external_metadata']);
  const usage = objet(meta['context_usage']);
  const tokens = nombre(usage['used_tokens']);
  const max = nombre(usage['max_tokens']);
  return {
    id,
    titre: texte(o['title']),
    bridge: texte(o['environment_kind']) === 'bridge',
    active: texte(o['status']) === 'active',
    connectee: texte(o['connection_status']) === 'connected',
    travail: texte(o['worker_status']),
    dernierEvenement: texte(o['last_event_at']),
    creeLe: texte(o['created_at']),
    majLe: texte(o['updated_at']),
    nonLue: booleen(o['unread']) === true,
    modele: texte(meta['model']) ?? texte(objet(o['config'])['model']),
    effort: texte(meta['effort_level']),
    contexte: tokens !== null && max !== null ? { tokens, max } : null,
  };
}

/** Une page d'événements (`{data, next_cursor}`) ; les entrées sans event_id sont écartées. */
export function lirePage(v: unknown): PageEvenements {
  const o = objet(v);
  const evenements = tableau(o['data']).flatMap((brut): EvenementBrut[] => {
    const e = objet(brut);
    const id = texte(e['event_id']);
    return id === null ? [] : [{ id, creeLe: texte(e['created_at']), payload: e['payload'] }];
  });
  return { evenements, suivant: texte(o['next_cursor']) };
}
