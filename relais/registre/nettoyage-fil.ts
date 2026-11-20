// Responsabilité : le nettoyage du fil d'une session au recalage — ce que les anciennes versions ont écrit de
// travers et qu'aucune relecture n'enlève : notifications de tâche rangées comme messages de Chris (bulles), lignes
// en double (même clé de dédoublonnage), écho direct d'un message dont la ligne du transcript est au fil, et — au vu
// du transcript entier — lignes étrangères (fil pollué, embranchement abandonné). La relecture complète qui suit
// comble ensuite les trous.
import type { Database } from 'bun:sqlite';
import type { Evenement } from '../../commun/session.ts';
import { cleDeDoublon, estEchoDirect } from '../parc/fusion-historique.ts';
import { cleTranscript } from '../../commun/cle-transcript.ts';

interface LigneBrute {
  readonly seq: number;
  readonly ts: string;
  readonly evt: string;
}

/** Une notification de tâche écrite comme message de Chris : elle n'en est pas un. */
export function estNotificationEnBulle(evt: Evenement): boolean {
  return evt.type === 'message' && evt.texte.trimStart().startsWith('<task-notification>');
}

/** Les lignes connues du transcript (recalage) : une ligne du fil principal qui porte une clé de transcript absente,
 *  écrite avant la fin lue du transcript, est étrangère. */
export interface LignesTranscript {
  readonly cles: ReadonlySet<string>;
  readonly messages: ReadonlySet<string>; // textes des messages de Chris du transcript
  readonly jusqua: string;
}

/** Ligne à retirer au vu du transcript entier : clé de transcript absente (étrangère), ou message sans uuid (écho
 *  direct, import ancien) dont le transcript porte le texte — la relecture qui suit le remet, à sa place, avec uuid. */
function etrangere(l: { ts: string; evt: Evenement }, transcript: LignesTranscript | undefined): boolean {
  if (!transcript || transcript.cles.size === 0 || l.ts > transcript.jusqua) return false;
  if (l.evt.type === 'message' && !l.evt.uuid) return transcript.messages.has(l.evt.texte);
  const cle = cleTranscript(l.evt);
  return cle !== null && !transcript.cles.has(cle);
}

/** Rangs des lignes à retirer (pur) : notifications en bulle, lignes étrangères au transcript et doublons, la première
 *  occurrence gardée. */
export function lignesARetirer(
  lignes: readonly { seq: number; ts: string; evt: Evenement }[],
  transcript?: LignesTranscript,
): number[] {
  const vues = new Set<string>();
  const retirer = new Set<number>();
  for (const l of lignes) {
    if (estNotificationEnBulle(l.evt) || etrangere(l, transcript)) {
      retirer.add(l.seq);
      continue;
    }
    const cle = cleDeDoublon({ ts: l.ts, evt: l.evt });
    if (vues.has(cle)) retirer.add(l.seq);
    else vues.add(cle);
  }
  // Écho direct d'un message (sans uuid) dont la ligne relue du transcript est déjà au fil : l'écho part.
  const relus = lignes.filter((l) => l.evt.type === 'message' && Boolean(l.evt.uuid) && !retirer.has(l.seq));
  const pris = new Set<number>();
  for (const l of lignes) {
    if (retirer.has(l.seq) || l.evt.type !== 'message' || l.evt.uuid) continue;
    const relu = relus.find((r) => !pris.has(r.seq) && estEchoDirect(l, r));
    if (relu) {
      pris.add(relu.seq);
      retirer.add(l.seq);
    }
  }
  return [...retirer].sort((a, b) => a - b);
}

/** Retire du fil les notifications en bulle et les doublons ; rend le nombre de lignes retirées. */
export function nettoyerFil(db: Database, sessionId: string, transcript?: LignesTranscript): number {
  return db.transaction((): number => {
    const brutes = db
      .query('SELECT seq, ts, evt FROM evenements WHERE session_id = ? ORDER BY seq')
      .all(sessionId) as LigneBrute[];
    // Lignes écrites par le relais lui-même selon le schéma Evenement.
    const lignes = brutes.map((b) => ({ seq: b.seq, ts: b.ts, evt: JSON.parse(b.evt) as Evenement }));
    const retirer = lignesARetirer(lignes, transcript);
    const supprimer = db.query('DELETE FROM evenements WHERE seq = ?');
    for (const seq of retirer) supprimer.run(seq);
    return retirer.length;
  })();
}
