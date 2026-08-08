/**
 * Preuve du déclenchement périodique (ce que rien n'appelait jusqu'ici) : le tick se
 * programme lui-même via `planifier`, relit `aucuneMissionActive` à CHAQUE tick (jamais une
 * valeur figée à la construction), refuse tant qu'une mission est active ou que la porte des
 * 7 jours n'est pas ouverte, et déclenche une vraie passe (rapport Markdown réel sur disque)
 * dès que les deux conditions sont réunies. `arreter()` coupe la reprogrammation.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from '../base/connexion.ts';
import { enregistrerDernierePasseA, obtenirDernierePasseA } from '../base/horloge-consolidation.ts';
import { demarrerConsolidationPeriodique, INTERVALLE_VERIFICATION_MS_DEFAUT } from './consolidation-periodique.ts';
import { INTERVALLE_MIN_MS } from './consolidation.ts';

const T0 = new Date('2026-08-08T10:00:00Z').getTime();

let dossier: string;
let cheminDb: string;
let racineCompetences: string;
let racineSauvegardes: string;
let racineRapports: string;
let db: Database;

/** Planificateur factice : capture le dernier tick programmé, ne l'exécute JAMAIS tout seul —
 *  un planifier synchrone bouclerait à l'infini sur une reprogrammation récursive. */
function planificateurCapture(): {
  readonly planifier: (delaiMs: number, tache: () => void) => void;
  readonly delais: number[];
  declencher(): void;
} {
  let dernierTache: (() => void) | null = null;
  const delais: number[] = [];
  return {
    planifier: (delaiMs, tache) => {
      delais.push(delaiMs);
      dernierTache = tache;
    },
    delais,
    declencher: () => dernierTache?.(),
  };
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-consolidation-periodique-'));
  cheminDb = join(dossier, 'apprentissage.db');
  racineCompetences = join(dossier, 'competences');
  racineSauvegardes = join(dossier, 'sauvegardes');
  racineRapports = join(dossier, 'rapports');
  db = ouvrirBaseApprentissage({ chemin: cheminDb });
});

afterEach(() => {
  fermerBaseApprentissage(db);
  rmSync(dossier, { recursive: true, force: true });
});

describe('demarrerConsolidationPeriodique — programmation', () => {
  test('programme un premier tick dès le démarrage, à l’intervalle par défaut', () => {
    const capture = planificateurCapture();
    demarrerConsolidationPeriodique({
      obtenirBase: () => db,
      cheminDb,
      racineCompetences,
      racineSauvegardes,
      racineRapports,
      aucuneMissionActive: () => true,
      maintenant: () => T0,
      planifier: capture.planifier,
    });
    expect(capture.delais).toEqual([INTERVALLE_VERIFICATION_MS_DEFAUT]);
  });

  test('respecte un intervalle de vérification personnalisé', () => {
    const capture = planificateurCapture();
    demarrerConsolidationPeriodique({
      obtenirBase: () => db,
      cheminDb,
      racineCompetences,
      aucuneMissionActive: () => true,
      intervalleVerificationMs: 1234,
      planifier: capture.planifier,
    });
    expect(capture.delais).toEqual([1234]);
  });

  test('chaque tick se reprogramme lui-même — la vérification continue', () => {
    const capture = planificateurCapture();
    demarrerConsolidationPeriodique({
      obtenirBase: () => db,
      cheminDb,
      racineCompetences,
      aucuneMissionActive: () => false, // porte fermée : le tick ne fait rien d'autre que se reprogrammer
      maintenant: () => T0,
      planifier: capture.planifier,
    });
    expect(capture.delais.length).toBe(1);
    capture.declencher();
    expect(capture.delais.length).toBe(2);
    capture.declencher();
    expect(capture.delais.length).toBe(3);
  });

  test('arreter() coupe la reprogrammation — le tick suivant ne planifie plus rien', () => {
    const capture = planificateurCapture();
    const { arreter } = demarrerConsolidationPeriodique({
      obtenirBase: () => db,
      cheminDb,
      racineCompetences,
      aucuneMissionActive: () => false,
      maintenant: () => T0,
      planifier: capture.planifier,
    });
    expect(capture.delais.length).toBe(1);
    arreter();
    capture.declencher();
    expect(capture.delais.length).toBe(1); // aucune reprogrammation après arrêt
  });
});

describe('demarrerConsolidationPeriodique — portes relues à chaque tick', () => {
  test('mission active ⇒ aucune passe, même horloge ouverte, jamais d’exception', () => {
    enregistrerDernierePasseA(db, T0 - INTERVALLE_MIN_MS - 1000); // horloge déjà ouverte
    const capture = planificateurCapture();
    let missionActive = true;
    demarrerConsolidationPeriodique({
      obtenirBase: () => db,
      cheminDb,
      racineCompetences,
      racineSauvegardes,
      racineRapports,
      aucuneMissionActive: () => !missionActive,
      maintenant: () => T0,
      planifier: capture.planifier,
    });
    expect(() => capture.declencher()).not.toThrow();
    expect(existsSync(racineRapports)).toBe(false); // aucune passe exécutée
    missionActive = false; // le thunk relit l'état courant, pas une valeur figée
    capture.declencher();
    expect(existsSync(racineRapports)).toBe(true); // cette fois la porte s'ouvre
  });

  test('base indisponible ⇒ tick ignoré sans exception, reprogrammé quand même', () => {
    const capture = planificateurCapture();
    demarrerConsolidationPeriodique({
      obtenirBase: () => null,
      cheminDb,
      racineCompetences,
      aucuneMissionActive: () => true,
      maintenant: () => T0,
      planifier: capture.planifier,
    });
    expect(() => capture.declencher()).not.toThrow();
    expect(capture.delais.length).toBe(2); // reprogrammé malgré l'absence de base
  });
});

describe('demarrerConsolidationPeriodique — artefact réel (préparation d’une passe automatique)', () => {
  test('≥ 7 jours + aucune mission active ⇒ passe RÉELLE, rapport écrit, horloge avancée', () => {
    const avant = T0 - INTERVALLE_MIN_MS - 1000;
    enregistrerDernierePasseA(db, avant); // horloge « semée » à plus de 7 jours dans le passé
    console.log('--- horloge AVANT tick ---', new Date(obtenirDernierePasseA(db)!).toISOString());

    const capture = planificateurCapture();
    demarrerConsolidationPeriodique({
      obtenirBase: () => db,
      cheminDb,
      racineCompetences,
      racineSauvegardes,
      racineRapports,
      aucuneMissionActive: () => true,
      maintenant: () => T0,
      planifier: capture.planifier,
    });
    capture.declencher();

    const apres = obtenirDernierePasseA(db);
    console.log('--- horloge APRÈS tick ---', new Date(apres!).toISOString());
    expect(apres).toBe(T0);
    expect(apres).not.toBe(avant);

    const fichiers = existsSync(racineRapports) ? readdirSync(racineRapports) : [];
    expect(fichiers.length).toBe(1);
    const rapport = readFileSync(join(racineRapports, fichiers[0]!), 'utf8');
    console.log('--- rapport de passe automatique (déclenchement périodique) ---\n' + rapport);
    expect(rapport).toContain('# Passe de consolidation');
  });
});
