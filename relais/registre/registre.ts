// Responsabilité : lire et écrire l'état du relais — machines, sessions, fil d'événements, notifications, jetons.
import type { Logger } from 'pino';
import type { Database } from 'bun:sqlite';
import type { EvenementDate, GenreAcces, Notification, VueMachine } from '../../commun/api-clients.ts';
import type { EtatMachine } from '../../commun/protocole-poste.ts';
import { EtatCompte } from '../../commun/comptes.ts';
import { type Categorie, ListeCategories, normaliserCategories } from '../../commun/categories.ts';
import { type GroupeMasque, ListeGroupesMasques, normaliserGroupesMasques } from '../../commun/groupes-masques.ts';
import { Evenement, ResumeSession } from '../../commun/session.ts';
import { inactiveDepuis, SEUIL_INACTIVITE_MS } from '../sessions/inactivite.ts';
import type { JetonsSession, RencontreMessage } from '../../commun/reste.ts';
import { jetonsSessionBase, rechercherMessagesBase } from './recherche.ts';

export type FicheMachine = Omit<VueMachine, 'enLigne'>;
export type { EvenementDate, Notification };

type LigneSession = { resume: string; archivee: number; epinglee: number; non_lue: number };
type LigneMachine = {
  id: string;
  description: string;
  racines: string;
  projets: string;
  comptes: string;
  version: string;
  etat: string | null;
  etat_comptes: string;
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
  constructor(
    private readonly db: Database,
    private readonly journal?: Logger,
    private readonly seuilInactiviteMs: number = SEUIL_INACTIVITE_MS,
  ) {}

  enregistrerMachine(m: Omit<FicheMachine, 'etat' | 'etatComptes'>): void {
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

  majComptes(id: string, comptes: readonly EtatCompte[]): void {
    this.db.query('UPDATE machines SET etat_comptes = $c WHERE id = $id').run({ id, c: JSON.stringify(comptes) });
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
      etatComptes: this.lireComptes(l.id, l.etat_comptes),
      derniereVue: l.derniere_vue,
    }));
  }

  // Le relevé d'usage du relais (dernière valeur bonne, prochain relevé) est posé sur les comptes lus de chaque machine.
  surFusionComptes(fusion: (comptes: readonly EtatCompte[]) => EtatCompte[]): void {
    this.fusionComptes = fusion;
  }

  private fusionComptes: (comptes: readonly EtatCompte[]) => EtatCompte[] = (comptes) => [...comptes];

  enregistrerSession(s: ResumeSession): void {
    this.db
      .query(
        `INSERT INTO sessions (id, machine, resume, maj_le) VALUES ($id, $m, $r, $maj)
      ON CONFLICT(id) DO UPDATE SET resume = $r, maj_le = $maj`,
      )
      .run({ id: s.id, m: s.machine, r: JSON.stringify(s), maj: s.majLe });
  }

  session(id: string): ResumeSession | null {
    const l = this.db
      .query('SELECT resume, archivee, epinglee, non_lue FROM sessions WHERE id = $id')
      .get({ id }) as LigneSession | null;
    return l ? this.vue(l) : null;
  }

  // Les archivées sont absentes par défaut ; `avecArchivees` les rend (filtre ?archivees=1, rétention du fil).
  sessions(avecArchivees = false): ResumeSession[] {
    const lignes = this.db
      .query('SELECT resume, archivee, epinglee, non_lue FROM sessions ORDER BY maj_le DESC')
      .all() as LigneSession[];
    return lignes.filter((l) => avecArchivees || l.archivee === 0).flatMap((l) => this.vue(l) ?? []);
  }

  definirArchivee(id: string, archivee: boolean): void {
    this.db.query('UPDATE sessions SET archivee = $a WHERE id = $id').run({ a: archivee ? 1 : 0, id });
  }

  // Épinglée : remontée en tête de la liste par le client ; colonne du relais, jamais écrasée par le poste.
  definirEpinglee(id: string, epinglee: boolean): void {
    this.db.query('UPDATE sessions SET epinglee = $e WHERE id = $id').run({ e: epinglee ? 1 : 0, id });
  }

  // Non lue : persistée pour survivre au redémarrage de l'appli (Lanterne la pose à la fin d'un tour hors vue, la retire
  // à l'ouverture). Colonne du relais, jamais écrasée par une fiche du poste.
  definirNonLue(id: string, nonLue: boolean): void {
    this.db.query('UPDATE sessions SET non_lue = $n WHERE id = $id').run({ n: nonLue ? 1 : 0, id });
  }

  // Suppression demandée par Chris, après que le poste a retiré le transcript : fiche, fil et notifications.
  supprimerSession(id: string): void {
    this.db.transaction(() => {
      this.db.query('DELETE FROM evenements WHERE session_id = $id').run({ id });
      this.db.query('DELETE FROM notifications WHERE session_id = $id').run({ id });
      this.db.query('DELETE FROM sessions WHERE id = $id').run({ id });
    })();
  }

  enregistrerEnvironnement(machine: string, dossier: string, quand: string): void {
    this.db
      .query(
        `INSERT INTO environnements (machine, dossier, enregistre_le) VALUES ($m, $d, $q)
      ON CONFLICT(machine, dossier) DO UPDATE SET enregistre_le = $q`,
      )
      .run({ m: machine, d: dossier, q: quand });
  }

  environnementsEnregistres(): { machine: string; dossier: string }[] {
    return this.db.query('SELECT machine, dossier FROM environnements ORDER BY enregistre_le DESC').all() as {
      machine: string;
      dossier: string;
    }[];
  }

  // Catégories de la barre latérale : un seul document, remplacé d'un bloc. Illisible → liste vide, journalisée.
  categories(): Categorie[] {
    const l = this.db.query('SELECT document FROM categories WHERE id = 1').get() as { document: string } | null;
    return l ? this.lireCategories(l.document) : [];
  }

  enregistrerCategories(liste: readonly Categorie[]): Categorie[] {
    const normalisees = normaliserCategories(liste);
    try {
      this.db
        .query(
          `INSERT INTO categories (id, document, maj_le) VALUES (1, $d, $m)
        ON CONFLICT(id) DO UPDATE SET document = $d, maj_le = $m`,
        )
        .run({ d: JSON.stringify(normalisees), m: new Date().toISOString() });
    } catch (e) {
      this.journal?.error({ erreur: String(e) }, 'catégories : écriture impossible');
      throw e;
    }
    return normalisees;
  }

  // Groupes masqués de la barre latérale : un seul document, remplacé d'un bloc (comme les catégories).
  groupesMasques(): GroupeMasque[] {
    const l = this.db.query('SELECT document FROM groupes_masques WHERE id = 1').get() as { document: string } | null;
    return l ? this.lireGroupesMasques(l.document) : [];
  }

  enregistrerGroupesMasques(liste: readonly GroupeMasque[]): GroupeMasque[] {
    const normalises = normaliserGroupesMasques(liste);
    try {
      this.db
        .query(
          `INSERT INTO groupes_masques (id, document, maj_le) VALUES (1, $d, $m)
        ON CONFLICT(id) DO UPDATE SET document = $d, maj_le = $m`,
        )
        .run({ d: JSON.stringify(normalises), m: new Date().toISOString() });
    } catch (e) {
      this.journal?.error({ erreur: String(e) }, 'groupes masqués : écriture impossible');
      throw e;
    }
    return normalises;
  }

  private lireGroupesMasques(brut: string): GroupeMasque[] {
    try {
      const r = ListeGroupesMasques.safeParse(JSON.parse(brut));
      if (r.success) return normaliserGroupesMasques(r.data);
      this.journal?.warn({ erreur: r.error.message.slice(0, 300) }, 'groupes masqués illisibles, ignorés');
    } catch (e) {
      this.journal?.warn({ erreur: String(e) }, 'groupes masqués illisibles, ignorés');
    }
    return [];
  }

  private lireCategories(brut: string): Categorie[] {
    try {
      const r = ListeCategories.safeParse(JSON.parse(brut));
      if (r.success) return r.data;
      this.journal?.warn({ erreur: r.error.message.slice(0, 300) }, 'catégories illisibles, ignorées');
    } catch (e) {
      this.journal?.warn({ erreur: String(e) }, 'catégories illisibles, ignorées');
    }
    return [];
  }

  // La vue rendue aux clients : la fiche du poste, le drapeau d'archivage (colonne, jamais écrasé par le poste) et
  // l'inactivité calculée à la lecture, pour qu'elle ne reste jamais périmée.
  private vue(l: LigneSession): ResumeSession | null {
    const fiche = this.lireFiche(l.resume);
    if (!fiche) return null;
    return {
      ...fiche,
      archivee: l.archivee === 1,
      epinglee: l.epinglee === 1,
      nonLue: l.non_lue === 1,
      inactiveDepuis: inactiveDepuis(fiche.statut, fiche.majLe, new Date(), this.seuilInactiviteMs),
    };
  }

  private lireComptes(machine: string, brut: string): EtatCompte[] {
    const r = EtatCompte.array().safeParse(JSON.parse(brut));
    if (!r.success) this.journal?.warn({ machine }, 'état des comptes illisible, ignoré');
    return this.fusionComptes(r.success ? r.data : []);
  }

  // Une fiche enregistrée par une version antérieure du contrat ne doit jamais faire tomber la lecture de toutes les
  // autres : le dialogue, éphémère, est abandonné s'il ne se lit plus ; une fiche vraiment illisible est écartée.
  private lireFiche(brut: string): ResumeSession | null {
    const objet: unknown = JSON.parse(brut);
    const r = ResumeSession.safeParse(objet);
    if (r.success) return r.data;
    const sansDialogue = ResumeSession.safeParse({ ...(objet as object), dialogue: null });
    if (sansDialogue.success) return sansDialogue.data;
    this.journal?.warn({ erreur: r.error.message.slice(0, 300) }, 'fiche de session illisible, écartée');
    return null;
  }

  ajouterEvenement(sessionId: string, ts: string, evt: Evenement): EvenementDate {
    const r = this.db
      .query('INSERT INTO evenements (session_id, ts, evt) VALUES ($s, $ts, $e) RETURNING seq')
      .get({ s: sessionId, ts, e: JSON.stringify(evt) }) as { seq: number };
    return { seq: r.seq, sessionId, ts, evt };
  }

  // Un lot d'historique, écrit d'un bloc : même ordre que le transcript, un seul passage.
  ajouterHistorique(sessionId: string, lot: readonly { readonly ts: string; readonly evt: Evenement }[]): number {
    const inserer = this.db.query('INSERT INTO evenements (session_id, ts, evt) VALUES ($s, $ts, $e)');
    return this.db.transaction(() => {
      for (const e of lot) inserer.run({ s: sessionId, ts: e.ts, e: JSON.stringify(e.evt) });
      return lot.length;
    })();
  }

  // La suite d'un fil déjà rempli (relecture fusionnée) : chaque événement reçoit son rang, renvoyé pour diffusion.
  ajouterSuite(sessionId: string, lot: readonly { readonly ts: string; readonly evt: Evenement }[]): EvenementDate[] {
    const inserer = this.db.query('INSERT INTO evenements (session_id, ts, evt) VALUES ($s, $ts, $e) RETURNING seq');
    return this.db.transaction(() =>
      lot.map((e) => {
        const r = inserer.get({ s: sessionId, ts: e.ts, e: JSON.stringify(e.evt) }) as { seq: number };
        return { seq: r.seq, sessionId, ts: e.ts, evt: e.evt };
      }),
    )();
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

  /** Autre session dont le fil contient l'une de ces lignes de transcript (uuid) ou l'un de ces appels d'outil (id) : la même conversation vue ailleurs
   * (jumelle Remote Control d'une session de poste). La plus récente des correspondances, ou null. */
  sessionPartageantUuid(uuids: readonly string[], sauf: string): string | null {
    if (uuids.length === 0) return null;
    const marques = uuids.map((_, i) => `$u${i}`).join(', ');
    const valeurs: Record<string, string> = { sauf };
    uuids.forEach((u, i) => (valeurs[`u${i}`] = u));
    const l = this.db
      .query(
        `SELECT session_id FROM evenements WHERE session_id <> $sauf AND substr(session_id, 1, 4) <> 'cse_'
      AND (json_extract(evt, '$.uuid') IN (${marques}) OR json_extract(evt, '$.id') IN (${marques}))
      ORDER BY seq DESC LIMIT 1`,
      )
      .get(valeurs) as { session_id: string } | null;
    return l?.session_id ?? null;
  }

  // Une page du fil antérieure au rang `avant` : les `limite` événements qui le précèdent, en ordre croissant.
  evenementsAvant(sessionId: string, avant: number, limite: number): EvenementDate[] {
    const lignes = this.db
      .query(
        `SELECT seq, session_id, ts, evt FROM evenements WHERE session_id = $s AND seq < $a
      ORDER BY seq DESC LIMIT $l`,
      )
      .all({ s: sessionId, a: avant, l: limite }) as { seq: number; session_id: string; ts: string; evt: string }[];
    return lignes
      .reverse()
      .map((l) => ({ seq: l.seq, sessionId: l.session_id, ts: l.ts, evt: Evenement.parse(JSON.parse(l.evt)) }));
  }

  // Messages (Chris et Claude) de toute la session qui contiennent `texte`, sans casse ; les `limite` plus récents,
  // en ordre croissant. `total` compte toutes les occurrences. Parcours complet : le fil entier n'est pas chargé.
  rechercherFil(sessionId: string, texte: string, limite: number): { total: number; resultats: EvenementDate[] } {
    const aiguille = texte.toLocaleLowerCase();
    if (aiguille === '') return { total: 0, resultats: [] };
    const lignes = this.db
      .query(
        `SELECT seq, session_id, ts, evt FROM evenements WHERE session_id = $s
      AND json_extract(evt, '$.type') IN ('message', 'texte') ORDER BY seq`,
      )
      .all({ s: sessionId }) as { seq: number; session_id: string; ts: string; evt: string }[];
    const trouvees: EvenementDate[] = [];
    for (const l of lignes) {
      const evt = Evenement.parse(JSON.parse(l.evt));
      if (evt.type !== 'message' && evt.type !== 'texte') continue;
      if (!evt.texte.toLocaleLowerCase().includes(aiguille)) continue;
      trouvees.push({ seq: l.seq, sessionId: l.session_id, ts: l.ts, evt });
    }
    return { total: trouvees.length, resultats: trouvees.slice(-limite) };
  }

  // Recherche globale : les messages (Chris et Claude) de toutes les sessions qui contiennent `requete`, les plus
  // récents d'abord, au plus `parSession` par session. Fiche de session (machine, titre, dossier) lue à chaque résultat.
  rechercherMessages(requete: string, maximum: number, parSession: number): RencontreMessage[] {
    const fiche = (id: string) => {
      const f = this.session(id);
      return f ? { machine: f.machine, titre: f.titre, cwd: f.cwd } : null;
    };
    return rechercherMessagesBase(this.db, fiche, requete, maximum, parSession, this.journal);
  }

  // Jetons d'une session (tours terminés) : somme des entrées et sorties relevées par le relais.
  jetonsSession(sessionId: string): JetonsSession {
    return jetonsSessionBase(this.db, sessionId);
  }

  // Messages épinglés comme chapitres : dernier état de chaque chapitre (un retrait l'annule).
  chapitresEpingles(sessionId: string): string[] {
    const lignes = this.db
      .query(
        `SELECT json_extract(evt, '$.uuid') AS uuid, json_extract(evt, '$.epingle') AS epingle FROM evenements
      WHERE session_id = $s AND json_extract(evt, '$.type') = 'chapitre' ORDER BY seq`,
      )
      .all({ s: sessionId }) as { uuid: string; epingle: number }[];
    const etat = new Map<string, boolean>();
    for (const l of lignes) etat.set(l.uuid, l.epingle === 1);
    return [...etat].filter(([, epingle]) => epingle).map(([uuid]) => uuid);
  }

  // Rang (seq) d'un message de Chris par son uuid, dans le fil de la session ; null s'il n'y est pas.
  rangMessage(sessionId: string, uuid: string): number | null {
    const ligne = this.db
      .query(
        `SELECT seq FROM evenements WHERE session_id = $s AND json_extract(evt, '$.type') = 'message'
      AND json_extract(evt, '$.uuid') = $u ORDER BY seq LIMIT 1`,
      )
      .get({ s: sessionId, u: uuid }) as { seq: number } | null;
    return ligne?.seq ?? null;
  }

  // Rang (seq) d'une entrée que Chris peut dupliquer ou épingler : son message, ou une réponse (uuid de `tour_fini`).
  rangEntree(sessionId: string, uuid: string): number | null {
    const ligne = this.db
      .query(
        `SELECT seq FROM evenements WHERE session_id = $s AND json_extract(evt, '$.type') IN ('message', 'tour_fini')
      AND json_extract(evt, '$.uuid') = $u ORDER BY seq LIMIT 1`,
      )
      .get({ s: sessionId, u: uuid }) as { seq: number } | null;
    return ligne?.seq ?? null;
  }

  // Retire du fil tous les événements à partir de ce rang (inclus) : le rembobinage.
  tronquerDepuis(sessionId: string, seq: number): number {
    return this.db.query('DELETE FROM evenements WHERE session_id = $s AND seq >= $q').run({ s: sessionId, q: seq }).changes;
  }

  // Supprime le fil des sessions données ; renvoie le nombre d'événements supprimés.
  purgerEvenements(sessionIds: readonly string[]): number {
    const supprimer = this.db.query('DELETE FROM evenements WHERE session_id = $s');
    return this.db.transaction(() => sessionIds.reduce((n, s) => n + supprimer.run({ s }).changes, 0))();
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

  creerJeton(empreinte: string, appareil: string, expireLe: string, genre: GenreAcces = 'appareil'): void {
    this.db
      .query('INSERT INTO jetons (empreinte, cree_le, expire_le, appareil, genre) VALUES ($e, $c, $x, $a, $g)')
      .run({ e: empreinte, c: new Date().toISOString(), x: expireLe, a: appareil, g: genre });
  }

  /** Le genre d'un jeton encore valide, null s'il est inconnu ou expiré. */
  genreJeton(empreinte: string): GenreAcces | null {
    const l = this.db.query('SELECT expire_le, genre FROM jetons WHERE empreinte = $e').get({ e: empreinte }) as {
      expire_le: string;
      genre: GenreAcces;
    } | null;
    return l !== null && l.expire_le > new Date().toISOString() ? l.genre : null;
  }

  noterUsageJeton(empreinte: string, quand: string): void {
    this.db.query('UPDATE jetons SET vu_le = $q WHERE empreinte = $e').run({ q: quand, e: empreinte });
  }

  jetons(): LigneJeton[] {
    return this.db
      .query('SELECT empreinte, appareil, genre, cree_le, expire_le, vu_le FROM jetons ORDER BY cree_le DESC')
      .all() as LigneJeton[];
  }

  revoquerJeton(empreinte: string): void {
    this.db.query('DELETE FROM jetons WHERE empreinte = $e').run({ e: empreinte });
  }

  /** Révoque par préfixe d'empreinte (l'id montré aux clients) ; rend le nombre de jetons retirés. */
  revoquerJetonParId(id: string): number {
    return this.db.query('DELETE FROM jetons WHERE substr(empreinte, 1, length($i)) = $i').run({ i: id }).changes;
  }

  purgerJetonsExpires(): void {
    this.db.query('DELETE FROM jetons WHERE expire_le <= $m').run({ m: new Date().toISOString() });
  }
}

export interface LigneJeton {
  readonly empreinte: string;
  readonly appareil: string;
  readonly genre: GenreAcces;
  readonly cree_le: string;
  readonly expire_le: string;
  readonly vu_le: string | null;
}
