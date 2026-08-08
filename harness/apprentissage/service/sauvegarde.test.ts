/**
 * Preuve E10 (sauvegarde) : copie de `apprentissage.db` et de `competences/` AVANT toute
 * passe mutante, rotation à 5 conservées (PLAN-PORTAGE.md E10, SPEC §5 C-4 `☠`).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listerSauvegardes, MAX_SAUVEGARDES_CONSERVEES, sauvegarderAvantPasse } from './sauvegarde.ts';

let racine: string;
let cheminDb: string;
let racineCompetences: string;
let racineSauvegardes: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'ccremote-sauvegarde-'));
  cheminDb = join(racine, 'apprentissage.db');
  racineCompetences = join(racine, 'competences');
  racineSauvegardes = join(racine, 'sauvegardes');
  writeFileSync(cheminDb, 'contenu-db-de-test');
  mkdirSync(join(racineCompetences, 'exemple-slug'), { recursive: true });
  writeFileSync(join(racineCompetences, 'exemple-slug', 'COMPETENCE.md'), '---\nnom: exemple-slug\n---\n');
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe('sauvegarderAvantPasse (E10)', () => {
  test('copie la base ET le dossier de compétences sous un dossier daté', () => {
    const resultat = sauvegarderAvantPasse({ cheminDb, racineCompetences, racineSauvegardes, maintenant: new Date('2026-08-08T10:00:00Z') });
    expect(resultat.aCopieDb).toBe(true);
    expect(resultat.aCopieCompetences).toBe(true);
    expect(existsSync(join(resultat.dossier, 'apprentissage.db'))).toBe(true);
    expect(readFileSync(join(resultat.dossier, 'apprentissage.db'), 'utf8')).toBe('contenu-db-de-test');
    expect(existsSync(join(resultat.dossier, 'competences', 'exemple-slug', 'COMPETENCE.md'))).toBe(true);
  });

  test('base absente ⇒ aCopieDb false, jamais une exception', () => {
    rmSync(cheminDb);
    const resultat = sauvegarderAvantPasse({ cheminDb, racineCompetences, racineSauvegardes, maintenant: new Date('2026-08-08T10:00:00Z') });
    expect(resultat.aCopieDb).toBe(false);
  });

  test('dossier de compétences absent ⇒ aCopieCompetences false, jamais une exception', () => {
    rmSync(racineCompetences, { recursive: true, force: true });
    const resultat = sauvegarderAvantPasse({ cheminDb, racineCompetences, racineSauvegardes, maintenant: new Date('2026-08-08T10:00:00Z') });
    expect(resultat.aCopieCompetences).toBe(false);
  });

  test(`rotation : au-delà de ${MAX_SAUVEGARDES_CONSERVEES} sauvegardes, seules les ${MAX_SAUVEGARDES_CONSERVEES} plus récentes restent`, () => {
    const jours = [1, 2, 3, 4, 5, 6, 7];
    for (const j of jours) {
      sauvegarderAvantPasse({ cheminDb, racineCompetences, racineSauvegardes, maintenant: new Date(`2026-08-0${j}T10:00:00Z`) });
    }
    const restantes = listerSauvegardes(racineSauvegardes);
    expect(restantes).toHaveLength(MAX_SAUVEGARDES_CONSERVEES);
    // Les deux plus anciennes (01 et 02 août) ont été retirées ; la plus récente (07) reste.
    expect(restantes.some((n) => n.startsWith('2026-08-01'))).toBe(false);
    expect(restantes.some((n) => n.startsWith('2026-08-02'))).toBe(false);
    expect(restantes.some((n) => n.startsWith('2026-08-07'))).toBe(true);
    console.log('--- Listing du dossier de sauvegardes après rotation à 5 ---\n' + restantes.join('\n'));
  });
});
