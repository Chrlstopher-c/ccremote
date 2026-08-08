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
