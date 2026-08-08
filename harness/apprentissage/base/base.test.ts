/**
 * Preuve E1 : la base s'ouvre, les migrations s'appliquent deux fois sans casser
 * les données, et le dépôt de leçons écrit/relit correctement (PLAN-PORTAGE.md, E1).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from './connexion.ts';
import { migrer, versionSchema, VERSION_SCHEMA_CIBLE } from './migrations.ts';
import {
  creerLecon,
  enregistrerObservation,
  enregistrerPasse,
  estMissionTraitee,
  listerLeconsParProjet,
  obtenirLecon,
  obtenirPasse,
} from './lecons.ts';

let dossier: string;
let chemin: string;
let db: Database;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-apprentissage-'));
  chemin = join(dossier, 'apprentissage.db');
  db = ouvrirBaseApprentissage({ chemin });
});

afterEach(() => {
  fermerBaseApprentissage(db);
  rmSync(dossier, { recursive: true, force: true });
});

describe('base d’apprentissage (E1)', () => {
  test('ouvrir applique le schéma cible', () => {
    expect(versionSchema(db)).toBe(VERSION_SCHEMA_CIBLE);
  });

  test('la migration appliquée deux fois ne casse rien', () => {
    const premiere = migrer(db);
    const seconde = migrer(db);
    expect(premiere).toBe(VERSION_SCHEMA_CIBLE);
    expect(seconde).toBe(VERSION_SCHEMA_CIBLE);
  });

  test('insère une leçon et la relit après une seconde migration', () => {
    const lecon = creerLecon(db, {
      id: 'lecon-1',
      projet: '/mnt/projects/ccremote',
      enonce: 'Toujours lire un artefact réel avant de conclure.',
      categorie: 'methode',
      portee: 'projet',
    });
    expect(lecon.etat).toBe('candidate');
    expect(lecon.confirmations).toBe(1);

    // La seconde application des migrations ne doit pas effacer la leçon.
    migrer(db);

    const relue = obtenirLecon(db, 'lecon-1');
    expect(relue).not.toBeNull();
    expect(relue?.enonce).toBe('Toujours lire un artefact réel avant de conclure.');
    expect(relue?.projet).toBe('/mnt/projects/ccremote');
  });

  test('liste les leçons d’un projet, filtrées par état', () => {
    creerLecon(db, {
      id: 'lecon-active',
      projet: 'proj-x',
      enonce: 'Une leçon active.',
      categorie: 'outil',
      portee: 'projet',
      etat: 'active',
    });
    creerLecon(db, {
      id: 'lecon-candidate',
      projet: 'proj-x',
      enonce: 'Une leçon candidate.',
      categorie: 'outil',
      portee: 'projet',
    });

    const actives = listerLeconsParProjet(db, 'proj-x', 'active');
    expect(actives).toHaveLength(1);
    expect(actives[0]?.id).toBe('lecon-active');

    const toutes = listerLeconsParProjet(db, 'proj-x');
    expect(toutes).toHaveLength(2);
  });

  test('enregistre une observation de rapprochement', () => {
    creerLecon(db, {
      id: 'lecon-obs',
      projet: 'proj-y',
      enonce: 'Une leçon observée.',
      categorie: 'piege',
      portee: 'projet',
    });
    expect(() =>
      enregistrerObservation(db, {
        leconId: 'lecon-obs',
        missionId: 'mission-1',
        sens: 'confirme',
        preuve: 'extrait du transcript',
        observeeA: Date.now(),
      }),
    ).not.toThrow();
  });

  test('une passe enregistrée rend la mission traitée — idempotence structurelle', () => {
    expect(estMissionTraitee(db, 'mission-2')).toBe(false);
    enregistrerPasse(db, {
      missionId: 'mission-2',
      traiteeA: Date.now(),
      issue: 'livree',
      leconsExtraites: 1,
      erreur: null,
    });
    expect(estMissionTraitee(db, 'mission-2')).toBe(true);
    expect(obtenirPasse(db, 'mission-2')?.issue).toBe('livree');
    // La clé primaire `mission_id` refuse un second enregistrement de la même mission.
    expect(() =>
      enregistrerPasse(db, {
        missionId: 'mission-2',
        traiteeA: Date.now(),
        issue: 'livree',
        leconsExtraites: 1,
        erreur: null,
      }),
    ).toThrow();
  });
});
