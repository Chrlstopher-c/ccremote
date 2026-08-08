/**
 * Responsabilité : dépôt des leçons, de leurs observations et des passes
 * d'apprentissage — le seul point d'accès en écriture/lecture à `apprentissage.db`
 * pour ces trois tables (SPEC-APPRENTISSAGE.md §5.7).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { executer } from '../logger.ts';
import type { CreationLecon, Lecon, LeconObservation, PasseApprentissage } from '../types.ts';

interface LigneLecon {
  readonly id: string;
  readonly projet: string;
  readonly machine: string | null;
  readonly enonce: string;
  readonly categorie: Lecon['categorie'];
  readonly portee: Lecon['portee'];
  readonly etat: Lecon['etat'];
  readonly confirmations: number;
  readonly contradictions: number;
  readonly creee_a: number;
  readonly derniere_confirmation_a: number;
  readonly servie_count: number;
}

function versLecon(ligne: LigneLecon): Lecon {
  return {
    id: ligne.id,
    projet: ligne.projet,
    machine: ligne.machine,
    enonce: ligne.enonce,
    categorie: ligne.categorie,
    portee: ligne.portee,
    etat: ligne.etat,
    confirmations: ligne.confirmations,
    contradictions: ligne.contradictions,
    creeeA: ligne.creee_a,
    derniereConfirmationA: ligne.derniere_confirmation_a,
    servieCount: ligne.servie_count,
  };
}

/** Crée une leçon, à l'état `candidate` par défaut (SPEC §1 : jamais servie hors confirmation). */
export function creerLecon(db: Database, creation: CreationLecon): Lecon {
  return executer(
    'creerLecon',
    () => {
      const creeeA = creation.creeeA ?? Date.now();
      const etat = creation.etat ?? 'candidate';
      const machine = creation.machine ?? null;
      db
        .query(
          `INSERT INTO lecon
             (id, projet, machine, enonce, categorie, portee, etat, confirmations, contradictions,
              creee_a, derniere_confirmation_a, servie_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 0)`,
        )
        .run(creation.id, creation.projet, machine, creation.enonce, creation.categorie, creation.portee, etat, creeeA, creeeA);
      const lecon = obtenirLecon(db, creation.id);
      if (lecon === null) throw new Error(`leçon ${creation.id} introuvable juste après sa création`);
      return lecon;
    },
    { id: creation.id, projet: creation.projet },
  );
}

export function obtenirLecon(db: Database, id: string): Lecon | null {
  return executer('obtenirLecon', () => {
    const ligne = db.query<LigneLecon, [string]>('SELECT * FROM lecon WHERE id = ?').get(id);
    return ligne === null ? null : versLecon(ligne);
  });
}

/** Leçons d'un projet, `etat` optionnel pour restreindre (ex. `active` pour C-6). */
export function listerLeconsParProjet(db: Database, projet: string, etat?: Lecon['etat']): readonly Lecon[] {
  return executer('listerLeconsParProjet', () => {
    const lignes =
      etat === undefined
        ? db
            .query<LigneLecon, [string]>('SELECT * FROM lecon WHERE projet = ? ORDER BY confirmations DESC')
            .all(projet)
        : db
            .query<LigneLecon, [string, string]>(
              'SELECT * FROM lecon WHERE projet = ? AND etat = ? ORDER BY confirmations DESC',
            )
            .all(projet, etat);
    return lignes.map(versLecon);
  });
}

/** Enregistre une observation de rapprochement (C-5) — ne met pas à jour `lecon` elle-même. */
export function enregistrerObservation(db: Database, observation: LeconObservation): void {
  executer(
    'enregistrerObservation',
    () => {
      db
        .query(
          'INSERT INTO lecon_observation (lecon_id, mission_id, sens, preuve, observee_a) VALUES (?, ?, ?, ?, ?)',
        )
        .run(observation.leconId, observation.missionId, observation.sens, observation.preuve, observation.observeeA);
    },
    { leconId: observation.leconId, missionId: observation.missionId },
  );
}

interface LignePasse {
  readonly mission_id: string;
  readonly traitee_a: number;
  readonly issue: PasseApprentissage['issue'];
  readonly lecons_extraites: number;
  readonly erreur: string | null;
}

function versPasse(ligne: LignePasse): PasseApprentissage {
  return {
    missionId: ligne.mission_id,
    traiteeA: ligne.traitee_a,
    issue: ligne.issue,
    leconsExtraites: ligne.lecons_extraites,
    erreur: ligne.erreur,
  };
}

/**
 * Enregistre qu'une mission a été traitée — clé d'idempotence (SPEC §5.7 `☠`).
 * `mission_id` est clé primaire : un second appel sur la même mission échoue, par
 * construction ; c'est à l'appelant (E6) de vérifier `estMissionTraitee` avant.
 */
export function enregistrerPasse(db: Database, passe: PasseApprentissage): void {
  executer(
    'enregistrerPasse',
    () => {
      db
        .query(
          `INSERT INTO passe_apprentissage (mission_id, traitee_a, issue, lecons_extraites, erreur)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(passe.missionId, passe.traiteeA, passe.issue, passe.leconsExtraites, passe.erreur);
    },
    { missionId: passe.missionId },
  );
}

/** Seuil de confirmations distinctes qui promeut une leçon `candidate` en `active` (SPEC §5, C-5). */
const SEUIL_CONFIRMATIONS_PROMOTION = 2;

export interface ResultatConfirmation {
  readonly lecon: Lecon;
  /** `true` ⇒ cette mission avait déjà confirmé cette leçon — aucun compteur incrémenté (idempotence). */
  readonly dejaConfirmeeParCetteMission: boolean;
  readonly promue: boolean;
}

function observationExiste(db: Database, leconId: string, missionId: string, sens: 'confirme' | 'contredit'): boolean {
  return executer('observationExiste', () => {
    const ligne = db
      .query<{ id: number }, [string, string, string]>(
        'SELECT id FROM lecon_observation WHERE lecon_id = ? AND mission_id = ? AND sens = ? LIMIT 1',
      )
      .get(leconId, missionId, sens);
    return ligne !== null;
  });
}

/**
 * Enregistre une confirmation (C-5) — idempotent PAR MISSION (SPEC §5.7 `☠`) : rejouer la
 * même mission sur la même leçon n'incrémente jamais un second coup `confirmations`, ce qui
 * est le seul rempart contre une promotion en `active` sur une observation dupliquée.
 * Promeut `candidate → active` dès `SEUIL_CONFIRMATIONS_PROMOTION` (2) missions distinctes.
 */
export function confirmerLecon(
  db: Database,
  leconId: string,
  missionId: string,
  preuve: string,
  maintenant: number = Date.now(),
): ResultatConfirmation {
  return executer(
    'confirmerLecon',
    () => {
      const lecon = obtenirLecon(db, leconId);
      if (lecon === null) throw new Error(`confirmerLecon : leçon ${leconId} introuvable`);
      if (observationExiste(db, leconId, missionId, 'confirme')) {
        return { lecon, dejaConfirmeeParCetteMission: true, promue: false };
      }
      enregistrerObservation(db, { leconId, missionId, sens: 'confirme', preuve, observeeA: maintenant });
      const confirmations = lecon.confirmations + 1;
      const promue = lecon.etat === 'candidate' && confirmations >= SEUIL_CONFIRMATIONS_PROMOTION;
      const etat = promue ? 'active' : lecon.etat;
      db
        .query('UPDATE lecon SET confirmations = ?, derniere_confirmation_a = ?, etat = ? WHERE id = ?')
        .run(confirmations, maintenant, etat, leconId);
      const misAJour = obtenirLecon(db, leconId);
      if (misAJour === null) throw new Error(`confirmerLecon : leçon ${leconId} disparue après mise à jour`);
      return { lecon: misAJour, dejaConfirmeeParCetteMission: false, promue };
    },
    { leconId, missionId },
  );
}

export interface ResultatContradiction {
  readonly lecon: Lecon;
  readonly dejaContrediteParCetteMission: boolean;
  readonly retrogradee: boolean;
}

/**
 * Enregistre une contradiction (C-5) — idempotent par mission, même garantie que
 * `confirmerLecon`. Asymétrie voulue par la spec : UNE SEULE contradiction rétrograde
 * immédiatement `active → candidate` — servir une leçon fausse coûte plus cher que ne pas
 * servir une leçon vraie.
 */
export function contredireLecon(
  db: Database,
  leconId: string,
  missionId: string,
  preuve: string,
  maintenant: number = Date.now(),
): ResultatContradiction {
  return executer(
    'contredireLecon',
    () => {
      const lecon = obtenirLecon(db, leconId);
      if (lecon === null) throw new Error(`contredireLecon : leçon ${leconId} introuvable`);
      if (observationExiste(db, leconId, missionId, 'contredit')) {
        return { lecon, dejaContrediteParCetteMission: true, retrogradee: false };
      }
      enregistrerObservation(db, { leconId, missionId, sens: 'contredit', preuve, observeeA: maintenant });
      const contradictions = lecon.contradictions + 1;
      const retrogradee = lecon.etat === 'active';
      const etat = retrogradee ? 'candidate' : lecon.etat;
      db.query('UPDATE lecon SET contradictions = ?, etat = ? WHERE id = ?').run(contradictions, etat, leconId);
      const misAJour = obtenirLecon(db, leconId);
      if (misAJour === null) throw new Error(`contredireLecon : leçon ${leconId} disparue après mise à jour`);
      return { lecon: misAJour, dejaContrediteParCetteMission: false, retrogradee };
    },
    { leconId, missionId },
  );
}

/**
 * Leçons `active` SERVABLES à un projet (C-6, SPEC §5.6) : portée `projet` sur ce projet
 * exact, portée `global` (`projet = '*'`), ou portée `machine` sur cette machine. Triées par
 * confirmations décroissantes puis récence — c'est déjà l'ordre attendu par `bloc-lecons.ts`.
 */
export function listerLeconsServables(db: Database, projet: string, machine: string | null): readonly Lecon[] {
  return executer('listerLeconsServables', () => {
    const lignes = db
      .query<LigneLecon, [string, string]>(
        `SELECT * FROM lecon
           WHERE etat = 'active'
             AND (projet = ? OR projet = '*' OR (portee = 'machine' AND machine = ?))
           ORDER BY confirmations DESC, derniere_confirmation_a DESC`,
      )
      .all(projet, machine ?? '');
    return lignes.map(versLecon);
  });
}

/**
 * Toutes les leçons de la base, `etat` optionnel pour restreindre — au contraire de
 * `listerLeconsParProjet`, balaie TOUS les projets (E10, C-4 : la passe de consolidation
 * examine l'horloge de chaque leçon, quel que soit son projet).
 */
export function listerToutesLecons(db: Database, etat?: Lecon['etat']): readonly Lecon[] {
  return executer('listerToutesLecons', () => {
    const lignes =
      etat === undefined
        ? db.query<LigneLecon, []>('SELECT * FROM lecon').all()
        : db.query<LigneLecon, [string]>('SELECT * FROM lecon WHERE etat = ?').all(etat);
    return lignes.map(versLecon);
  });
}

/**
 * Change l'état d'une leçon SANS toucher ses compteurs (E10, C-4 : transitions par horloge).
 * `☠` Jamais de suppression : `obsolete` est un état comme les autres, la ligne reste
 * (SPEC §5, C-4 `☠`). Ne lève jamais sur un id inexistant — rend `null`, laisse l'appelant
 * (une passe de consolidation, jamais bloquante) décider.
 */
export function transitionnerEtatLecon(db: Database, id: string, nouvelEtat: Lecon['etat']): Lecon | null {
  return executer(
    'transitionnerEtatLecon',
    () => {
      const avant = obtenirLecon(db, id);
      if (avant === null) return null;
      db.query('UPDATE lecon SET etat = ? WHERE id = ?').run(nouvelEtat, id);
      return obtenirLecon(db, id);
    },
    { id, nouvelEtat },
  );
}

export function obtenirPasse(db: Database, missionId: string): PasseApprentissage | null {
  return executer('obtenirPasse', () => {
    const ligne = db
      .query<LignePasse, [string]>('SELECT * FROM passe_apprentissage WHERE mission_id = ?')
      .get(missionId);
    return ligne === null ? null : versPasse(ligne);
  });
}

export function estMissionTraitee(db: Database, missionId: string): boolean {
  return executer('estMissionTraitee', () => obtenirPasse(db, missionId) !== null);
}
