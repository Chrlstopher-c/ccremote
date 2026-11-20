// Responsabilité : appliquer en base la fusion d'un lot de l'historique dans le fil d'une session. Le calcul de la
// place de chaque événement est pur (parc/fusion-historique.ts) ; ici : lecture des lignes concernées, écriture en une
// transaction. Un fil sans aucune ligne du transcript en commun avec la relecture complète est remplacé par elle.
import type { Database } from 'bun:sqlite';
import type { EvenementDate } from '../../commun/api-clients.ts';
import type { Evenement } from '../../commun/session.ts';
import { cleTranscript } from '../../commun/cle-transcript.ts';
import {
  ECHO_MS,
  cleDeDoublon,
  type EvenementHorodate,
  identifiantsDuLot,
  type LigneFil,
  planifierFusion,
} from '../parc/fusion-historique.ts';

export interface OptionsFusion {
  readonly complet: boolean; // relecture complète (tout le transcript) : fusion chronologique
  readonly premier: boolean; // premier lot de cette relecture : seul moment où un fil désynchronisé est remplacé
}

export interface ResultatFusion {
  readonly ajoutes: readonly EvenementDate[]; // lignes ajoutées sans réécriture : à diffuser telles quelles
  readonly reecrit: boolean; // la suite du fil a été réécrite (rangs changés) : rien n'est diffusé, le fil se relit
  readonly remplace: boolean; // le fil existant ne contenait aucune ligne du transcript : remplacé
}

const RIEN: ResultatFusion = { ajoutes: [], reecrit: false, remplace: false };

interface LigneBrute {
  readonly seq: number;
  readonly ts: string;
  readonly evt: string;
}

function ligneFil(brute: LigneBrute): LigneFil {
  const evt = JSON.parse(brute.evt) as Evenement;
  const base = { ts: brute.ts, evt };
  return { ...base, seq: brute.seq, cle: cleDeDoublon(base) };
}

function lignesDepuis(db: Database, sessionId: string, ts: string): LigneFil[] {
  const brutes = db
    .query('SELECT seq, ts, evt FROM evenements WHERE session_id = ? AND ts >= ? ORDER BY seq')
    .all(sessionId, ts) as LigneBrute[];
  return brutes.map(ligneFil);
}

/** Clés déjà au fil pour les identifiants du lot, où qu'elles soient dans le temps (résultat d'une tâche de fond). */
function clesPresentes(db: Database, sessionId: string, lot: readonly EvenementHorodate[]): Set<string> {
  const { uuids, ids } = identifiantsDuLot(lot);
  if (uuids.length + ids.length === 0) return new Set();
  const marques = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
  const brutes = db
    .query(
      `SELECT seq, ts, evt FROM evenements WHERE session_id = ? AND (
         json_extract(evt, '$.uuid') IN (${marques(uuids.length)})
         OR json_extract(evt, '$.id') IN (${marques(ids.length)})
         OR json_extract(evt, '$.outilId') IN (${marques(ids.length)}))`,
    )
    .all(sessionId, ...uuids, ...ids, ...ids) as LigneBrute[];
  return new Set(brutes.map((b) => ligneFil(b).cle));
}

function plusTot(lot: readonly EvenementHorodate[]): string {
  return lot.reduce((min, e) => (e.ts < min ? e.ts : min), lot[0]?.ts ?? '');
}

/** Début de la fenêtre du fil relue pour un lot : un peu avant son premier événement, pour y retrouver l'écho direct
 *  (sans uuid, écrit à l'envoi) d'un message de Chris que le transcript date un peu plus tard. */
function debutFenetre(lot: readonly EvenementHorodate[]): string {
  const debut = Date.parse(plusTot(lot));
  return Number.isFinite(debut) ? new Date(debut - ECHO_MS).toISOString() : plusTot(lot);
}

/** Fil désynchronisé : le premier lot de la relecture complète couvre tout le fil principal (aucune de ses lignes de
 *  transcript n'est plus récente que le lot) sans en partager une seule (fil venu d'une autre source, jamais recalé).
 *  Un lot qui ne couvre pas le fil ne décide rien : la suite du transcript peut porter les lignes communes. Les lignes
 *  des sous-agents (leur transcript est à part) ne comptent pas. */
function filDesynchronise(db: Database, sessionId: string, lot: readonly EvenementHorodate[]): boolean {
  const tous = db
    .query('SELECT seq, ts, evt FROM evenements WHERE session_id = ? ORDER BY seq')
    .all(sessionId) as LigneBrute[];
  const lignes = tous.map(ligneFil).filter((l) => cleTranscript(l.evt) !== null);
  if (lignes.length === 0) return false;
  const fin = lot.reduce((max, e) => (e.ts > max ? e.ts : max), '');
  if (lignes.some((l) => l.ts > fin)) return false;
  const cles = new Set(lot.map(cleDeDoublon));
  return !lignes.some((l) => cles.has(l.cle));
}

/** Remplace le fil principal par le lot ; les lignes de sous-agents des appels du lot restent (fil à part). */
function remplacerFil(db: Database, sessionId: string, lot: readonly EvenementHorodate[]): void {
  const appels = new Set(lot.flatMap(({ evt }) => (evt.type === 'sous_agent' || evt.type === 'outil' ? [evt.id] : [])));
  const tous = db.query('SELECT seq, ts, evt FROM evenements WHERE session_id = ?').all(sessionId) as LigneBrute[];
  const supprimer = db.query('DELETE FROM evenements WHERE seq = ?');
  for (const b of tous) {
    const evt = JSON.parse(b.evt) as Evenement; // écrit par le relais selon le schéma Evenement
    const agent = 'agent' in evt ? evt.agent : undefined;
    if (!agent || !appels.has(agent)) supprimer.run(b.seq);
  }
  const inserer = db.query('INSERT INTO evenements (session_id, ts, evt) VALUES (?, ?, ?)');
  for (const e of lot) inserer.run(sessionId, e.ts, JSON.stringify(e.evt));
}

/** Fusionne un lot dans le fil d'une session, sans doublon, chaque événement à sa place chronologique. */
export function fusionnerDansFil(
  db: Database,
  sessionId: string,
  lot: readonly EvenementHorodate[],
  options: OptionsFusion,
): ResultatFusion {
  if (lot.length === 0) return RIEN;
  return db.transaction((): ResultatFusion => {
    if (options.complet && options.premier && filDesynchronise(db, sessionId, lot)) {
      remplacerFil(db, sessionId, lot);
      return { ajoutes: [], reecrit: false, remplace: true };
    }
    const existants = lignesDepuis(db, sessionId, debutFenetre(lot));
    const plan = planifierFusion(existants, lot, clesPresentes(db, sessionId, lot));
    const inserer = db.query('INSERT INTO evenements (session_id, ts, evt) VALUES (?, ?, ?) RETURNING seq');
    if (plan.premierDeplace < 0) {
      const ajoutes = plan.fil
        .filter((l) => l.seq === null)
        .map((l) => {
          const r = inserer.get(sessionId, l.ts, JSON.stringify(l.evt)) as { seq: number };
          return { seq: r.seq, sessionId, ts: l.ts, evt: l.evt };
        });
      return { ajoutes, reecrit: false, remplace: false };
    }
    const retires = existants.slice(plan.premierDeplace);
    const supprimer = db.query('DELETE FROM evenements WHERE seq = ?');
    for (const l of retires) supprimer.run(l.seq);
    const ecrire = db.query('INSERT INTO evenements (session_id, ts, evt) VALUES (?, ?, ?)');
    for (const l of plan.fil.slice(plan.premierDeplace)) ecrire.run(sessionId, l.ts, JSON.stringify(l.evt));
    return { ajoutes: [], reecrit: true, remplace: false };
  })();
}

/** Vrai si une ligne du lot est déjà au fil (même clé). Faux : le lot ne se raccorde à rien (fil venu d'ailleurs). */
export function partageUneLigne(db: Database, sessionId: string, lot: readonly EvenementHorodate[]): boolean {
  if (lot.length === 0) return false;
  const cles = new Set(lot.map(cleDeDoublon));
  const presentes = [...lignesDepuis(db, sessionId, plusTot(lot)).map((l) => l.cle), ...clesPresentes(db, sessionId, lot)];
  return presentes.some((c) => cles.has(c));
}
