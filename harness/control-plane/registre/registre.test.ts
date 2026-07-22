/**
 * Tests du registre — schéma, accès, et les deux pannes silencieuses de M-03
 * (grille de revue #30 : états fusionnés · #5 : dimensionnement missions courtes).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { ouvrirRegistre, type Registre } from './index.ts';
import { VERSION_SCHEMA_CIBLE } from './migrations.ts';

let repertoire: string;
let chemin: string;
let registre: Registre;

function amorcer(r: Registre): void {
  r.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  r.lots.creer({ id: 'lot-1', intention: 'corriger le bug de login' });
}

function creerMission(r: Registre, id: string, projet: string, lotId = 'lot-1'): void {
  r.missions.creer({ id, lotId, nom: id, projet, compteId: 'compte1' });
}

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'registre-test-'));
  chemin = join(repertoire, 'sous-dossier', 'registre.sqlite');
  registre = ouvrirRegistre({ chemin });
  amorcer(registre);
});

afterEach(() => {
  try {
    registre.fermer();
  } catch {
    /* déjà fermé par le test */
  }
  rmSync(repertoire, { recursive: true, force: true });
});

// ---------------------------------------------------------------- schéma

describe('schéma et migrations', () => {
  test('le schéma est migré à la version cible à l ouverture', () => {
    expect(registre.version).toBe(VERSION_SCHEMA_CIBLE);
  });

  test('rouvrir ne rejoue pas les migrations (idempotence)', () => {
    registre.fermer();
    const r2 = ouvrirRegistre({ chemin });
    expect(r2.version).toBe(VERSION_SCHEMA_CIBLE);
    const db = new Database(chemin, { readonly: true });
    const lignes = db
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM migration_appliquee')
      .get();
    expect(lignes?.n).toBe(VERSION_SCHEMA_CIBLE);
    db.close(false);
    r2.fermer();
  });
});

// ------------------------------------------------- ☠ panne #30 — deux champs

describe('☠ panne #30 — états SDK et états harness dans des champs distincts', () => {
  test('un état SDK n écrit jamais l état harness, et réciproquement', () => {
    creerMission(registre, 'm-1', 'projet-alpha');

    const apresHarness = registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    expect(apresHarness.etatHarness).toBe('en_cours');
    expect(apresHarness.etatSdk).toBeNull();

    const apresSdk = registre.etats.appliquerEtatSdk('m-1', 'running');
    expect(apresSdk.etatSdk).toBe('running');
    expect(apresSdk.etatHarness).toBe('en_cours');

    const pause = registre.etats.appliquerEtatHarness('m-1', 'en_pause');
    // La décision du Pi ne touche pas ce que le worker a rapporté.
    expect(pause.etatHarness).toBe('en_pause');
    expect(pause.etatSdk).toBe('running');

    const bloque = registre.etats.appliquerEtatSdk('m-1', 'requires_action');
    expect(bloque.etatSdk).toBe('requires_action');
    expect(bloque.etatHarness).toBe('en_pause');
  });

  test('les horodatages des deux états sont indépendants', () => {
    creerMission(registre, 'm-1', 'projet-alpha');
    registre.etats.appliquerEtatHarness('m-1', 'en_cours', { maintenant: 1_000 });
    registre.etats.appliquerEtatSdk('m-1', 'running', 2_000);
    const m = registre.missions.exiger('m-1');
    expect(m.etatHarnessMajA).toBe(1_000);
    expect(m.etatSdkMajA).toBe(2_000);
  });

  test('la base refuse un état harness dans la colonne SDK', () => {
    creerMission(registre, 'm-1', 'projet-alpha');
    const db = new Database(chemin);
    expect(() =>
      db.query('UPDATE mission SET etat_sdk = ? WHERE id = ?').run('en_pause', 'm-1'),
    ).toThrow();
    db.close(false);
  });

  test('la base refuse un état SDK dans la colonne harness', () => {
    creerMission(registre, 'm-1', 'projet-alpha');
    const db = new Database(chemin);
    expect(() =>
      db.query('UPDATE mission SET etat_harness = ? WHERE id = ?').run('running', 'm-1'),
    ).toThrow();
    db.close(false);
  });

  test('l historique conserve l origine de chaque transition', () => {
    creerMission(registre, 'm-1', 'projet-alpha');
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    registre.etats.appliquerEtatSdk('m-1', 'running');
    registre.etats.appliquerEtatSdk('m-1', 'requires_action');
    registre.etats.appliquerEtatHarness('m-1', 'terminee', { motif: 'mandat accompli' });

    expect(registre.etats.historiqueParOrigine('m-1', 'sdk').map((t) => t.etatNouveau)).toEqual([
      'running',
      'requires_action',
    ]);
    expect(
      registre.etats.historiqueParOrigine('m-1', 'harness').map((t) => t.etatNouveau),
    ).toEqual(['en_cours', 'terminee']);
  });

  test('réappliquer le même état ne crée pas de transition en double', () => {
    creerMission(registre, 'm-1', 'projet-alpha');
    registre.etats.appliquerEtatSdk('m-1', 'running');
    registre.etats.appliquerEtatSdk('m-1', 'running');
    expect(registre.etats.historique('m-1')).toHaveLength(1);
  });
});

// -------------------------------------------------------- persistance réelle

describe('persistance réelle sur disque', () => {
  test('écrire, fermer, rouvrir, relire — rien n est perdu', () => {
    creerMission(registre, 'm-1', 'projet-alpha');
    registre.missions.attacherSession('m-1', 'sess-abc');
    registre.etats.appliquerEtatHarness('m-1', 'en_cours', { maintenant: 5_000 });
    registre.etats.appliquerEtatSdk('m-1', 'requires_action', 6_000);
    registre.missions.avancerHighWaterMark('m-1', 42);
    registre.missions.incrementerEpoch('m-1');
    registre.missions.ajouterCout('m-1', 1.25);
    registre.capacites.enregistrer('m-1', { reinitialize: true, parent_agent_id: false });
    registre.comptes.releverQuota({
      compteId: 'compte1',
      typeFenetre: 'five_hour',
      statut: 'allowed',
      resetA: 1_784_714_400,
    });
    registre.fermer();

    const r2 = ouvrirRegistre({ chemin });
    const m = r2.missions.exiger('m-1');
    expect(m.sessionId).toBe('sess-abc');
    expect(m.etatHarness).toBe('en_cours');
    expect(m.etatSdk).toBe('requires_action');
    expect(m.highWaterMark).toBe(42);
    expect(m.epoch).toBe(1);
    expect(m.budgetConsommeUsd).toBeCloseTo(1.25);
    expect(m.compteId).toBe('compte1');
    expect(r2.etats.historique('m-1')).toHaveLength(2);
    expect(r2.capacites.estPresente('m-1', 'parent_agent_id')).toBe(false);
    expect(r2.comptes.lireQuota('compte1', 'five_hour')?.resetA).toBe(1_784_714_400);
    r2.fermer();
  });

  test('un lecteur concurrent en lecture seule voit les écritures du seul écrivain', () => {
    creerMission(registre, 'm-1', 'projet-alpha');
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    const lecteur = ouvrirRegistre({ chemin, lectureSeule: true });
    expect(lecteur.missions.exiger('m-1').etatHarness).toBe('en_cours');
    registre.etats.appliquerEtatHarness('m-1', 'terminee');
    expect(lecteur.missions.exiger('m-1').etatHarness).toBe('terminee');
    lecteur.fermer();
  });

  test('une ouverture en lecture seule ne peut pas écrire', () => {
    const lecteur = ouvrirRegistre({ chemin, lectureSeule: true });
    expect(() => creerMission(lecteur, 'm-2', 'projet-beta')).toThrow();
    lecteur.fermer();
  });
});
