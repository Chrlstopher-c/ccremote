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
import { ecrireCompetence } from '../competences/depot-competences.ts';
import type { Competence } from '../types.ts';
import { composerBlocLecons } from './bloc-lecons.ts';

let dossier: string;
let chemin: string;
let racineCompetences: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-bloc-lecons-'));
  chemin = join(dossier, 'apprentissage.db');
  racineCompetences = join(dossier, 'competences');
  process.env['CCREMOTE_APPRENTISSAGE_DB'] = chemin;
  process.env['CCREMOTE_APPRENTISSAGE_COMPETENCES_DIR'] = racineCompetences;
});

afterEach(() => {
  delete process.env['CCREMOTE_APPRENTISSAGE_DB'];
  delete process.env['CCREMOTE_APPRENTISSAGE_COMPETENCES_DIR'];
  rmSync(dossier, { recursive: true, force: true });
});

function semerCompetenceActive(slug: string, nom: string, projet: string): void {
  const competence: Competence = {
    slug,
    nom,
    description: `Description de ${nom}`,
    portee: 'projet',
    projet,
    etat: 'active',
    confirmations: 3,
    origine: [],
    maj: '2026-08-08',
  };
  ecrireCompetence(racineCompetences, { competence, corps: { quand: ['x'], etapes: ['y'], pieges: [] } });
}

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

describe('composerBlocLecons — extension E8 : index des compétences', () => {
  test('une compétence active du projet apparaît sous son propre titre, avec chemin absolu', () => {
    semerLeconActive('lecon-active', 'Toujours lire un artefact réel avant de conclure.', 2);
    semerCompetenceActive('reprise-worktree-git', 'reprise-worktree-git', PROJET);
    const bloc = composerBlocLecons(PROJET);
    expect(bloc).toContain('PROCÉDURES DÉJÀ ÉCRITES POUR CE PROJET');
    expect(bloc).toContain('reprise-worktree-git');
    expect(bloc).toContain(join(racineCompetences, 'reprise-worktree-git', 'COMPETENCE.md'));
  });

  test('zéro compétence active ⇒ pas de titre « PROCÉDURES », le bloc de leçons reste seul', () => {
    semerLeconActive('lecon-active', 'Toujours lire un artefact réel avant de conclure.', 2);
    const bloc = composerBlocLecons(PROJET);
    expect(bloc).not.toContain('PROCÉDURES DÉJÀ ÉCRITES');
  });

  test('une compétence active mais d’un AUTRE projet n’apparaît pas (isolation par projet)', () => {
    semerLeconActive('lecon-active', 'Toujours lire un artefact réel avant de conclure.', 2);
    semerCompetenceActive('competence-autre-projet', 'competence-autre-projet', '/mnt/projects/tout-autre');
    const bloc = composerBlocLecons(PROJET);
    expect(bloc).not.toContain('competence-autre-projet');
  });

  test('zéro leçon active ⇒ chaîne vide même si une compétence active existe (SPEC §5, C-6 `☠`)', () => {
    semerCompetenceActive('reprise-worktree-git', 'reprise-worktree-git', PROJET);
    expect(composerBlocLecons(PROJET)).toBe('');
  });

  test('dossier de compétences absent ⇒ bloc de leçons quand même servi, jamais bloquant', () => {
    semerLeconActive('lecon-active', 'Toujours lire un artefact réel avant de conclure.', 2);
    // Aucune compétence semée : `racineCompetences` n'existe même pas sur le disque.
    const bloc = composerBlocLecons(PROJET);
    expect(bloc).toContain('Toujours lire un artefact réel avant de conclure.');
    expect(bloc).not.toContain('PROCÉDURES DÉJÀ ÉCRITES');
  });
});
