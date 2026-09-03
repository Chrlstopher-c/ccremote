/**
 * Responsabilité : accès aux teams persistantes (migration 35, axe B).
 * Une team est une équipe qui SURVIT à ses missions ; chaque mission en est une
 * ACTIVATION. Ce dépôt porte le cycle de vie dormante → active → dormante, la
 * réutilisation du worktree au réveil, le démantèlement, et la détection TTL.
 *
 * `☠` Les transitions d'état sont GARDÉES par un `WHERE etat = …` dans l'UPDATE,
 * jamais par une lecture préalable suivie d'une écriture : deux appels
 * concurrents ne doivent pas pouvoir activer deux fois la même team dormante.
 * Le nombre de lignes modifiées (`changes`) dit si la transition a réellement eu
 * lieu — une transition qui ne matche rien lève, elle n'acquitte pas en silence.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import type { CreationTeam, EtatTeam, Team } from './types.ts';

interface LigneTeam {
  id: string;
  projet: string;
  domaine: string;
  worktree: string | null;
  branche: string | null;
  compte_id: string | null;
  etat: string;
  resume_contexte: string | null;
  resume_maj_a: number | null;
  derniere_mission_id: string | null;
  cree_a: number;
  active_derniere_fois_a: number;
}

function versTeam(l: LigneTeam): Team {
  return {
    id: l.id,
    projet: l.projet,
    domaine: l.domaine,
    worktree: l.worktree,
    branche: l.branche,
    compteId: l.compte_id,
    // as : colonne sous CHECK IN ('dormante','active','demantelee') — aucune autre valeur possible.
    etat: l.etat as EtatTeam,
    resumeContexte: l.resume_contexte,
    resumeMajA: l.resume_maj_a,
    derniereMissionId: l.derniere_mission_id,
    creeA: l.cree_a,
    activeDerniereFoisA: l.active_derniere_fois_a,
  };
}

/** Paramètres d'activation, connus seulement au dispatch (compte choisi, worktree alloué). */
export interface ActivationTeam {
  readonly worktree?: string | null;
  readonly branche?: string | null;
  readonly compteId?: string | null;
  readonly missionId?: string | null;
}

export class ErreurTransitionTeam extends Error {
  constructor(
    readonly teamId: string,
    readonly transition: string,
  ) {
    super(
      `transition « ${transition} » impossible sur la team « ${teamId} » — état de départ inattendu ou team absente`,
    );
    this.name = 'ErreurTransitionTeam';
  }
}

export class DepotTeams {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Crée une team `dormante`. `☠` Pas `active` : la création et l'activation
   * sont deux gestes (l'activation renseigne worktree/compte, connus seulement au
   * dispatch). L'index unique `(projet, domaine) WHERE etat != 'demantelee'`
   * refuse une seconde team vivante sur le même domaine — la garde est en base.
   */
  public creer(creation: CreationTeam, maintenant: number = Date.now()): Team {
    return executer(
      'teams.creer',
      () => {
        this.db
          .query(
            `INSERT INTO team (
               id, projet, domaine, worktree, branche, compte_id, etat,
               resume_contexte, resume_maj_a, derniere_mission_id, cree_a, active_derniere_fois_a
             ) VALUES (?, ?, ?, ?, ?, ?, 'dormante', NULL, NULL, NULL, ?, ?)`,
          )
          .run(
            creation.id,
            creation.projet,
            creation.domaine,
            creation.worktree ?? null,
            creation.branche ?? null,
            creation.compteId ?? null,
            maintenant,
            maintenant,
          );
        return this.exiger(creation.id);
      },
      { id: creation.id, projet: creation.projet, domaine: creation.domaine },
    );
  }

  public lire(id: string): Team | null {
    return executer(
      'teams.lire',
      () => {
        const ligne = this.db.query<LigneTeam, [string]>('SELECT * FROM team WHERE id = ?').get(id);
        return ligne ? versTeam(ligne) : null;
      },
      { id },
    );
  }

  public exiger(id: string): Team {
    const team = this.lire(id);
    if (team === null) throw new Error(`team « ${id} » introuvable`);
    return team;
  }

  /**
   * La team VIVANTE (dormante ou active) sur ce domaine, ou `null`. `☠` Exclut
   * `demantelee` : un (projet, domaine) démantelé est de nouveau libre, sa team
   * finie ne doit jamais être réveillée. L'index unique garantit qu'il n'y en a
   * qu'une — `get()` suffit.
   */
  public lireVivantePourDomaine(projet: string, domaine: string): Team | null {
    return executer(
      'teams.lireVivantePourDomaine',
      () => {
        const ligne = this.db
          .query<LigneTeam, [string, string]>(
            "SELECT * FROM team WHERE projet = ? AND domaine = ? AND etat != 'demantelee'",
          )
          .get(projet, domaine);
        return ligne ? versTeam(ligne) : null;
      },
      { projet, domaine },
    );
  }

  /**
   * Teams `dormante` PORTANT un worktree — la source de la restauration PC (axe B).
   * `☠` `dormante` seulement, et worktree NON NULL : ce sont exactement les teams
   * dont le worktree survit sur disque en veille et qu'il faut réamorcer dans la
   * Map du gestionnaire au démarrage du superviseur, pour qu'un réveil ne retente
   * pas un `git worktree add`. Une team `active` a un worker vivant (restauré par
   * une autre voie) ; une team sans worktree n'a rien à réamorcer.
   */
  public listerDormantesAvecWorktree(): readonly Team[] {
    return executer('teams.listerDormantesAvecWorktree', () => {
      const lignes = this.db
        .query<LigneTeam, []>("SELECT * FROM team WHERE etat = 'dormante' AND worktree IS NOT NULL ORDER BY cree_a")
        .all();
      return lignes.map(versTeam);
    });
  }

  /** Teams vivantes d'un projet — sert à COMPTER (plafond ≤ 3), jamais l'historique démantelé. */
  public listerVivantesDuProjet(projet: string): readonly Team[] {
    return executer(
      'teams.listerVivantesDuProjet',
      () => {
        const lignes = this.db
          .query<LigneTeam, [string]>(
            "SELECT * FROM team WHERE projet = ? AND etat != 'demantelee' ORDER BY cree_a",
          )
          .all(projet);
        return lignes.map(versTeam);
      },
      { projet },
    );
  }

  /**
   * `dormante` → `active` : une activation démarre. Renseigne worktree/branche/
   * compte/mission (connus au dispatch) sans jamais ÉCRASER une valeur existante
   * par `null` — au réveil, le worktree persistant doit survivre à une activation
   * qui ne le re-transmet pas (`COALESCE(?, colonne)`).
   *
   * `☠` `WHERE etat = 'dormante'` : garde la transition. Une team déjà `active`
   * ne se ré-active pas (c'est le cas file, B2) ; l'UPDATE ne matche rien et on
   * lève plutôt que d'acquitter une transition qui n'a pas eu lieu.
   */
  public activer(id: string, params: ActivationTeam = {}, maintenant: number = Date.now()): Team {
    // `☠` La transition et son échec sont HORS `executer` : ce dernier
    // envelopperait `ErreurTransitionTeam` en `ErreurRegistre` et les appelants
    // ne pourraient plus la rattraper par son type. Seul l'accès SQLite est
    // gardé par `executer`.
    const changes = executer(
      'teams.activer',
      () =>
        this.db
          .query(
            `UPDATE team SET
               etat = 'active',
               worktree = COALESCE(?, worktree),
               branche = COALESCE(?, branche),
               compte_id = COALESCE(?, compte_id),
               derniere_mission_id = COALESCE(?, derniere_mission_id),
               active_derniere_fois_a = ?
             WHERE id = ? AND etat = 'dormante'`,
          )
          .run(
            params.worktree ?? null,
            params.branche ?? null,
            params.compteId ?? null,
            params.missionId ?? null,
            maintenant,
            id,
          ).changes,
      { id },
    );
    if (changes === 0) throw new ErreurTransitionTeam(id, 'activer (dormante→active)');
    return this.exiger(id);
  }

  /**
   * Enregistre le worktree/branche RÉELLEMENT alloués pour une team active (le
   * dispatch les connaît après l'allocation PC). `☠` N'écrase jamais avec `null`.
   */
  public definirWorktree(id: string, worktree: string, branche: string | null): void {
    executer(
      'teams.definirWorktree',
      () => {
        this.db
          .query('UPDATE team SET worktree = ?, branche = COALESCE(?, branche) WHERE id = ?')
          .run(worktree, branche, id);
      },
      { id },
    );
  }

  /**
   * `active` → `dormante` : l'activation s'est conclue, la team survit et
   * redevient réveillable. Met à jour l'horodatage d'activité (base du TTL).
   */
  public endormir(id: string, maintenant: number = Date.now()): Team {
    const changes = executer(
      'teams.endormir',
      () =>
        this.db
          .query("UPDATE team SET etat = 'dormante', active_derniere_fois_a = ? WHERE id = ? AND etat = 'active'")
          .run(maintenant, id).changes,
      { id },
    );
    if (changes === 0) throw new ErreurTransitionTeam(id, 'endormir (active→dormante)');
    return this.exiger(id);
  }

  /**
   * → `demantelee` : terminal. Le worktree est libéré HORS de ce dépôt (ressource
   * PC) ; ici on ne fait qu'acter l'état. `☠` Idempotent depuis n'importe quel
   * état non-terminal (dormante OU active) : une dissolution forcée par
   * l'opérateur ne doit pas échouer parce qu'une activation traînait `active`.
   */
  public demanteler(id: string, maintenant: number = Date.now()): Team {
    const changes = executer(
      'teams.demanteler',
      () =>
        this.db
          .query(
            "UPDATE team SET etat = 'demantelee', active_derniere_fois_a = ? WHERE id = ? AND etat != 'demantelee'",
          )
          .run(maintenant, id).changes,
      { id },
    );
    if (changes === 0) throw new ErreurTransitionTeam(id, 'demanteler');
    return this.exiger(id);
  }

  /** Résumé de reprise (D2) — rempli par le hook `PreCompact` (B3). */
  public majResume(id: string, resume: string, maintenant: number = Date.now()): void {
    executer(
      'teams.majResume',
      () => {
        this.db.query('UPDATE team SET resume_contexte = ?, resume_maj_a = ? WHERE id = ?').run(resume, maintenant, id);
      },
      { id },
    );
  }

  /**
   * Teams `dormante` inactives depuis AVANT `seuil` — candidates au démantèlement
   * TTL (7 j). `☠` Seuil = horodatage absolu calculé par l'appelant avec SON
   * horloge injectable (`maintenant - 7j`), jamais `Date.now()` en dur ici : c'est
   * ce qui rend le TTL testable sans attendre une semaine.
   *
   * `☠` `dormante` seulement : une team `active` ne se démantèle jamais par TTL
   * (une activation tourne), même si son dernier réveil est ancien.
   */
  public listerDormantesInactivesAvant(seuil: number): readonly Team[] {
    return executer(
      'teams.listerDormantesInactivesAvant',
      () => {
        const lignes = this.db
          .query<LigneTeam, [number]>(
            "SELECT * FROM team WHERE etat = 'dormante' AND active_derniere_fois_a <= ? " +
              'ORDER BY active_derniere_fois_a',
          )
          .all(seuil);
        return lignes.map(versTeam);
      },
      { seuil },
    );
  }
}
