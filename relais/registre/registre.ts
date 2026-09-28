// Responsabilité : lire et écrire l'état du relais — machines, sessions, fil d'événements, notifications, jetons.
import type { Database } from 'bun:sqlite';
import type { EvenementDate, Notification, VueMachine } from '../../commun/api-clients.ts';
import type { EtatMachine } from '../../commun/protocole-poste.ts';
import { Evenement, ResumeSession } from '../../commun/session.ts';

export type FicheMachine = Omit<VueMachine, 'enLigne'>;
export type { EvenementDate, Notification };

type LigneMachine = {
  id: string;
  description: string;
  racines: string;
  projets: string;
  comptes: string;
  version: string;
  etat: string | null;
  derniere_vue: string;
};
type LigneNotif = {
  seq: number;
  session_id: string | null;
  niveau: Notification['niveau'];
  titre: string;
  texte: string;
  ts: string;
  lue: number;
};

export class Registre {
  constructor(private readonly db: Database) {}

  enregistrerMachine(m: Omit<FicheMachine, 'etat'>): void {
    this.db
      .query(
        `INSERT INTO machines (id, description, racines, projets, comptes, version, derniere_vue)
      VALUES ($id, $d, $r, $p, $c, $v, $vue) ON CONFLICT(id) DO UPDATE SET description=$d, racines=$r, projets=$p,
      comptes=$c, version=$v, derniere_vue=$vue`,
      )
      .run({
        id: m.id,
        d: m.description,
        r: JSON.stringify(m.racines),
        p: JSON.stringify(m.projets),
        c: JSON.stringify(m.comptes),
        v: m.version,
        vue: m.derniereVue,
      });
  }

  majEtatMachine(id: string, etat: EtatMachine): void {
    this.db
      .query('UPDATE machines SET etat = $e, derniere_vue = $vue WHERE id = $id')
      .run({ id, e: JSON.stringify(etat), vue: new Date().toISOString() });
  }

  machines(): FicheMachine[] {
    return (this.db.query('SELECT * FROM machines ORDER BY id').all() as LigneMachine[]).map((l) => ({
      id: l.id,
      description: l.description,
      racines: JSON.parse(l.racines),
      projets: JSON.parse(l.projets),
      comptes: JSON.parse(l.comptes),
      version: l.version,
      etat: l.etat ? JSON.parse(l.etat) : null,
      derniereVue: l.derniere_vue,
    }));
  }

  enregistrerSession(s: ResumeSession): void {
    this.db
      .query(
        `INSERT INTO sessions (id, machine, resume, maj_le) VALUES ($id, $m, $r, $maj)
      ON CONFLICT(id) DO UPDATE SET resume = $r, maj_le = $maj`,
      )
      .run({ id: s.id, m: s.machine, r: JSON.stringify(s), maj: s.majLe });
  }

  session(id: string): ResumeSession | null {
    const l = this.db.query('SELECT resume FROM sessions WHERE id = $id').get({ id }) as { resume: string } | null;
    return l ? ResumeSession.parse(JSON.parse(l.resume)) : null;
  }

  sessions(): ResumeSession[] {
    const lignes = this.db.query('SELECT resume FROM sessions ORDER BY maj_le DESC').all() as { resume: string }[];
    return lignes.map((l) => ResumeSession.parse(JSON.parse(l.resume)));
  }

  ajouterEvenement(sessionId: string, ts: string, evt: Evenement): EvenementDate {
    const r = this.db
      .query('INSERT INTO evenements (session_id, ts, evt) VALUES ($s, $ts, $e) RETURNING seq')
      .get({ s: sessionId, ts, e: JSON.stringify(evt) }) as { seq: number };
    return { seq: r.seq, sessionId, ts, evt };
  }

  evenements(sessionId: string, apres: number, limite = 500): EvenementDate[] {
    const lignes = this.db
      .query(
        `SELECT seq, session_id, ts, evt FROM evenements WHERE session_id = $s AND seq > $a
      ORDER BY seq LIMIT $l`,
      )
      .all({ s: sessionId, a: apres, l: limite }) as { seq: number; session_id: string; ts: string; evt: string }[];
    return lignes.map((l) => ({
      seq: l.seq,
      sessionId: l.session_id,
      ts: l.ts,
      evt: Evenement.parse(JSON.parse(l.evt)),
    }));
  }

  // Les derniers événements d'une session, pour ouvrir son fil sans tout recharger.
  derniersEvenements(sessionId: string, nombre: number): EvenementDate[] {
    const lignes = this.db
      .query(
        `SELECT seq, session_id, ts, evt FROM evenements WHERE session_id = $s
      ORDER BY seq DESC LIMIT $n`,
      )
      .all({ s: sessionId, n: nombre }) as { seq: number; session_id: string; ts: string; evt: string }[];
    return lignes
      .reverse()
      .map((l) => ({ seq: l.seq, sessionId: l.session_id, ts: l.ts, evt: Evenement.parse(JSON.parse(l.evt)) }));
  }

  ajouterNotification(n: Omit<Notification, 'seq' | 'lue'>): Notification {
    const r = this.db
      .query(
        `INSERT INTO notifications (session_id, niveau, titre, texte, ts) VALUES ($s, $n, $t, $x, $ts)
      RETURNING seq`,
      )
      .get({ s: n.sessionId, n: n.niveau, t: n.titre, x: n.texte, ts: n.ts }) as { seq: number };
    return { ...n, seq: r.seq, lue: false };
  }

  notifications(apres: number, limite = 100): Notification[] {
    const lignes = this.db
      .query('SELECT * FROM notifications WHERE seq > $a ORDER BY seq DESC LIMIT $l')
      .all({ a: apres, l: limite }) as LigneNotif[];
    return lignes.map((l) => ({
      seq: l.seq,
      sessionId: l.session_id,
      niveau: l.niveau,
      titre: l.titre,
      texte: l.texte,
      ts: l.ts,
      lue: l.lue === 1,
    }));
  }

  marquerLues(jusqua: number): void {
    this.db.query('UPDATE notifications SET lue = 1 WHERE seq <= $s').run({ s: jusqua });
  }

  creerJeton(empreinte: string, appareil: string, expireLe: string): void {
    this.db
      .query('INSERT INTO jetons (empreinte, cree_le, expire_le, appareil) VALUES ($e, $c, $x, $a)')
      .run({ e: empreinte, c: new Date().toISOString(), x: expireLe, a: appareil });
  }

  jetonValide(empreinte: string): boolean {
    const l = this.db.query('SELECT expire_le FROM jetons WHERE empreinte = $e').get({ e: empreinte }) as {
      expire_le: string;
    } | null;
    return l !== null && l.expire_le > new Date().toISOString();
  }

  revoquerJeton(empreinte: string): void {
    this.db.query('DELETE FROM jetons WHERE empreinte = $e').run({ e: empreinte });
  }
}
