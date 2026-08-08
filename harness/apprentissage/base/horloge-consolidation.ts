/**
 * Responsabilité : dater la dernière passe de consolidation (C-4, SPEC §5, PLAN-PORTAGE.md
 * E10) — une ligne unique dans `consolidation_etat` (migration 2). Ne décide jamais rien sur
 * `lecon` : seule `service/consolidation.ts` lit cette horloge pour ouvrir ou refuser la porte
 * des 7 jours.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { executer } from '../logger.ts';

/** `null` ⇒ aucune passe n'a jamais été semée ni exécutée (SPEC §5, C-4 : « première observation »). */
export function obtenirDernierePasseA(db: Database): number | null {
  return executer('obtenirDernierePasseA', () => {
    const ligne = db.query<{ derniere_passe_a: number }, []>('SELECT derniere_passe_a FROM consolidation_etat WHERE id = 1').get();
    return ligne?.derniere_passe_a ?? null;
  });
}

/** Écrit l'horodatage (création OU mise à jour) — un seul appelant à la fois par construction (E10). */
export function enregistrerDernierePasseA(db: Database, maintenant: number): void {
  executer(
    'enregistrerDernierePasseA',
    () => {
      db
        .query(
          `INSERT INTO consolidation_etat (id, derniere_passe_a) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET derniere_passe_a = excluded.derniere_passe_a`,
        )
        .run(maintenant);
    },
    { maintenant },
  );
}
