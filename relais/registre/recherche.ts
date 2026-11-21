// Responsabilité : les requêtes de lecture de la recherche globale et des jetons, sur la base du relais. Lecture seule.
// Le LIKE ne fait que préfiltrer les événements ; le filtre exact (sans casse, espaces normalisés) est fait en JS.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import { extraitAutour, motifLike, type JetonsSession, type RencontreMessage } from '../../commun/reste.ts';

// Plafond de candidats lus par la requête SQL : au-delà, les plus anciens ne sont pas cherchés.
export const PLAFOND_CANDIDATS = 5000;

export interface FicheResumee {
  readonly machine: string;
  readonly titre: string;
  readonly cwd: string;
}

interface LigneEvenement {
  readonly seq: number;
  readonly session_id: string;
  readonly ts: string;
  readonly evt: string;
}

type TexteEvenement = { readonly type: 'message' | 'texte'; readonly texte: string };

/** Les `maximum` occurrences les plus récentes, au plus `parSession` par session, dans les messages et textes. */
export function rechercherMessagesBase(
  db: Database,
  fiche: (id: string) => FicheResumee | null,
  requete: string,
  maximum: number,
  parSession: number,
  journal?: Logger,
): RencontreMessage[] {
  const lignes = db
    .query(
      `SELECT e.seq, e.session_id, e.ts, e.evt FROM evenements e
      WHERE e.evt LIKE $motif ESCAPE '!' AND json_extract(e.evt, '$.type') IN ('message', 'texte')
      ORDER BY e.seq DESC LIMIT $cap`,
    )
    .all({ motif: motifLike(requete), cap: PLAFOND_CANDIDATS }) as LigneEvenement[];
  const parSessionCompte = new Map<string, number>();
  const trouvees: RencontreMessage[] = [];
  for (const l of lignes) {
    if (trouvees.length >= maximum) break;
    if ((parSessionCompte.get(l.session_id) ?? 0) >= parSession) continue;
    const rencontre = rencontreDe(l, requete, fiche, journal);
    if (!rencontre) continue;
    parSessionCompte.set(l.session_id, (parSessionCompte.get(l.session_id) ?? 0) + 1);
    trouvees.push(rencontre);
  }
  return trouvees;
}

function rencontreDe(
  l: LigneEvenement,
  requete: string,
  fiche: (id: string) => FicheResumee | null,
  journal?: Logger,
): RencontreMessage | null {
  const evt = texteDe(l.evt, journal);
  if (!evt) return null;
  const trouve = extraitAutour(evt.texte, requete);
  const f = trouve ? fiche(l.session_id) : null;
  if (!trouve || !f) return null;
  return {
    seq: l.seq,
    sessionId: l.session_id,
    machine: f.machine,
    titre: f.titre,
    dossier: f.cwd,
    ts: l.ts,
    role: evt.type === 'message' ? 'chris' : 'claude',
    ...trouve,
  };
}

// Un événement stocké → son texte, seulement pour un message de Chris ou une réponse ; null sinon ou si illisible.
function texteDe(brut: string, journal?: Logger): TexteEvenement | null {
  let objet: unknown;
  try {
    objet = JSON.parse(brut);
  } catch (erreur) {
    journal?.warn({ err: erreur }, 'événement illisible : ignoré par la recherche');
    return null;
  }
  if (typeof objet !== 'object' || objet === null) return null;
  const { type, texte } = objet as { type?: unknown; texte?: unknown };
  if ((type !== 'message' && type !== 'texte') || typeof texte !== 'string') return null;
  return { type, texte };
}

/** Jetons d'une session : somme des `tour_fini` (entrée, sortie) et nombre de tours ; zéros si session inconnue.
 * Un tour porté deux fois (SDK puis transcript relu, chevauchement) ne compte qu'une fois : même `uuid` de réponse. */
export function jetonsSessionBase(db: Database, sessionId: string): JetonsSession {
  const l = db
    .query(
      `SELECT COALESCE(SUM(json_extract(evt, '$.entree')), 0) AS entree,
        COALESCE(SUM(json_extract(evt, '$.sortie')), 0) AS sortie, COUNT(*) AS tours
      FROM evenements WHERE session_id = $s AND json_extract(evt, '$.type') = 'tour_fini'
        AND (json_extract(evt, '$.uuid') IS NULL OR seq IN (
          SELECT MIN(seq) FROM evenements WHERE session_id = $s AND json_extract(evt, '$.type') = 'tour_fini'
            AND json_extract(evt, '$.uuid') IS NOT NULL GROUP BY json_extract(evt, '$.uuid')))`,
    )
    .get({ s: sessionId }) as { entree: number; sortie: number; tours: number } | null;
  const dernier = db
    .query(
      `SELECT json_extract(evt, '$.coutUsd') AS cout FROM evenements WHERE session_id = $s
        AND json_extract(evt, '$.type') = 'tour_fini' ORDER BY seq DESC LIMIT 1`,
    )
    .get({ s: sessionId }) as { cout: number | null } | null;
  const cout = dernier?.cout ?? null;
  return { entree: l?.entree ?? 0, sortie: l?.sortie ?? 0, tours: l?.tours ?? 0, ...(cout === null ? {} : { cout }) };
}
