/**
 * Preuve E1 (ouverture) : l'écriture crée dossier ET fichier depuis rien (premier allumage) ;
 * la lecture d'une base absente est l'état NORMAL — aucun journal d'erreur — alors qu'une
 * vraie panne (base corrompue) reste journalisée en erreur (défaut constaté sur le déploiement
 * réel : SQLITE_CANTOPEN journalisé en erreur à chaque mandat sur un système jamais initialisé).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { journal } from '../logger.ts';
import { ErreurBaseAbsente, fermerBaseApprentissage, ouvrirBaseApprentissage } from './connexion.ts';

let dossier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-connexion-'));
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe('ouvrirBaseApprentissage — écriture (E1, premier allumage)', () => {
  test('crée le dossier parent ET le fichier quand ni l’un ni l’autre n’existent', () => {
    const chemin = join(dossier, 'sous-dossier-absent', 'apprentissage.db');
    expect(existsSync(chemin)).toBe(false);

    const db = ouvrirBaseApprentissage({ chemin });
    fermerBaseApprentissage(db);

    expect(existsSync(chemin)).toBe(true);
  });
});

describe('ouvrirBaseApprentissage — lecture d’une base absente (E1, C-6)', () => {
  test('lève ErreurBaseAbsente, pas ErreurApprentissage', () => {
    const chemin = join(dossier, 'jamais-ecrite.db');
    expect(() => ouvrirBaseApprentissage({ chemin, lectureSeule: true })).toThrow(ErreurBaseAbsente);
  });

  test('n’émet AUCUN journal d’erreur — état normal au premier démarrage, pas une panne', () => {
    const chemin = join(dossier, 'jamais-ecrite.db');
    const espionErreur = spyOn(journal, 'error');
    try {
      expect(() => ouvrirBaseApprentissage({ chemin, lectureSeule: true })).toThrow();
      expect(espionErreur).not.toHaveBeenCalled();
    } finally {
      espionErreur.mockRestore();
    }
  });
});

describe('ouvrirBaseApprentissage — vraie panne (droits refusés)', () => {
  test('la lecture d’un fichier présent mais illisible journalise une erreur', () => {
    const chemin = join(dossier, 'sans-droits.db');
    writeFileSync(chemin, 'peu importe le contenu — seul le droit d’accès compte ici');
    chmodSync(chemin, 0o000);
    const espionErreur = spyOn(journal, 'error');
    try {
      expect(() => ouvrirBaseApprentissage({ chemin, lectureSeule: true })).toThrow();
      expect(espionErreur).toHaveBeenCalled();
    } finally {
      espionErreur.mockRestore();
      chmodSync(chemin, 0o600); // sinon rmSync (afterEach) échoue à nettoyer selon l’umask
    }
  });
});
