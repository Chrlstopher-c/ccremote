/**
 * Preuve E7 (1/3) : bornes respectées, tri correct, base vide ⇒ chaîne vide
 * (PLAN-PORTAGE.md E7). La preuve 3/3 — l'artefact réel — est
 * `acceptation/apprentissage-injection-reel.ts`.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from '../base/connexion.ts';
import { creerLecon, confirmerLecon } from '../base/lecons.ts';
import { composerBlocLecons } from './bloc-lecons.ts';

let dossier: string;
let chemin: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-bloc-lecons-'));
  chemin = join(dossier, 'apprentissage.db');
  process.env['CCREMOTE_APPRENTISSAGE_DB'] = chemin;
});

afterEach(() => {
  delete process.env['CCREMOTE_APPRENTISSAGE_DB'];
  rmSync(dossier, { recursive: true, force: true });
});

const PROJET = '/mnt/projects/exemple';

function semerLeconActive(id: string, enonce: string, confirmations = 2): void {
  const db = ouvrirBaseApprentissage({ chemin });
  creerLecon(db, { id, projet: PROJET, enonce, categorie: 'methode', portee: 'projet' });
  for (let i = 1; i < confirmations; i += 1) confirmerLecon(db, id, `mission-${i}`, 'preuve', Date.now());
  fermerBaseApprentissage(db);
}

describe('composerBlocLecons (E7, C-6)', () => {
  test('base absente (jamais initialisée) ⇒ chaîne vide, jamais une exception', () => {
    expect(composerBlocLecons(PROJET)).toBe('');
  });

  test('base présente mais sans leçon active pour ce projet ⇒ chaîne vide', () => {
    const db = ouvrirBaseApprentissage({ chemin });
    fermerBaseApprentissage(db);
    expect(composerBlocLecons(PROJET)).toBe('');
  });

  test('une leçon candidate (1 seule confirmation) ⇒ pas servie', () => {
    semerLeconActive('lecon-candidate', 'Toujours committer avant de migrer.', 1);
    expect(composerBlocLecons(PROJET)).toBe('');
  });

  test('une leçon active ⇒ présente dans le bloc, avec titre, phrase et compteur', () => {
    semerLeconActive('lecon-active', 'Toujours lire un artefact réel avant de conclure.', 2);
    const bloc = composerBlocLecons(PROJET);
    expect(bloc).toContain('CE QUE LES ÉQUIPES PRÉCÉDENTES ONT APPRIS SUR CE PROJET');
    expect(bloc).toContain("contredis-les si tu constates l'inverse");
    expect(bloc).toContain('Toujours lire un artefact réel avant de conclure.');
    expect(bloc).toContain('confirmée 2×');
  });

  test('plus de 5 leçons actives ⇒ au plus 5 servies, triées par confirmations décroissantes', () => {
    for (let i = 0; i < 7; i += 1) semerLeconActive(`lecon-${i}`, `Énoncé numéro ${i} suffisamment distinct.`, 2 + i);
    const bloc = composerBlocLecons(PROJET);
    const lignes = bloc.split('\n').filter((l) => l.startsWith('· '));
    expect(lignes).toHaveLength(5);
    // La plus confirmée (lecon-6, 8 confirmations) doit être en tête.
    expect(lignes[0]).toContain('numéro 6');
  });

  test('projet différent ⇒ leçon non servie (isolation par projet)', () => {
    semerLeconActive('lecon-autre-projet', 'Une leçon qui ne concerne pas ce projet.', 2);
    expect(composerBlocLecons('/mnt/projects/tout-autre')).toBe('');
  });
});
