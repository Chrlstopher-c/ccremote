/**
 * Responsabilité : trace durable des échecs d'`append` (E.3.3, principe directeur de M-31).
 *
 * ☠ Le `mirror_error` que le SDK émet vit dans le flux de la session — un consommateur qui
 * crashe ou n'écoute pas ce flux ne le voit jamais. Cette table est la deuxième trace,
 * indépendante du flux, interrogeable après coup par la réconciliation (E.1.4, M-30) ou
 * l'UI : « ce miroir a-t-il des trous, et depuis quand ? ». C'est elle qui rend la
 * divergence miroir/vérité détectable plutôt que silencieuse.
 */

import type { Database } from 'bun:sqlite';
import { executer } from './journal.ts';
import type { LigneDefaillance } from './lignes.ts';

export interface Defaillance {
  readonly projetCle: string;
  readonly sessionId: string;
  readonly sousChemin: string;
  readonly cause: string;
  readonly survenuA: number;
}

export class DepotDefaillances {
  constructor(private readonly db: Database) {}

  public enregistrer(
    projetCle: string,
    sessionId: string,
    sousChemin: string,
    cause: string,
    survenuA: number,
  ): void {
    executer(
      'defaillances.enregistrer',
      () => {
        this.db
          .query(
            `INSERT INTO session_defaillance
               (project_key, session_id, subpath, cause, survenu_a)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(projetCle, sessionId, sousChemin, cause, survenuA);
      },
      { projetCle, sessionId, sousChemin, cause },
    );
  }

  public lister(projetCle: string, sessionId: string): readonly Defaillance[] {
    return executer(
      'defaillances.lister',
      () => {
        const lignes = this.db
          .query<LigneDefaillance, [string, string]>(
            `SELECT * FROM session_defaillance
              WHERE project_key = ? AND session_id = ?
              ORDER BY survenu_a DESC`,
          )
          .all(projetCle, sessionId);
        return lignes.map(versDefaillance);
      },
      { projetCle, sessionId },
    );
  }

  public compter(projetCle: string, sessionId: string): number {
    return executer(
      'defaillances.compter',
      () => {
        const ligne = this.db
          .query<{ n: number }, [string, string]>(
            'SELECT COUNT(*) AS n FROM session_defaillance WHERE project_key = ? AND session_id = ?',
          )
          .get(projetCle, sessionId);
        return ligne?.n ?? 0;
      },
      { projetCle, sessionId },
    );
  }
}

function versDefaillance(l: LigneDefaillance): Defaillance {
  return {
    projetCle: l.project_key,
    sessionId: l.session_id,
    sousChemin: l.subpath,
    cause: l.cause,
    survenuA: l.survenu_a,
  };
}
