/**
 * Preuve E10 (1/2) : les quatre transitions par horloge, le refus de tourner à moins de 7
 * jours, le refus si une mission est active, et la première observation qui sème sans
 * exécuter (PLAN-PORTAGE.md E10). La preuve 2/2 — l'artefact réel — est le dernier bloc de ce
 * fichier : il colle le contenu RÉEL d'un rapport de passe et le listing des sauvegardes.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from '../base/connexion.ts';
import { obtenirDernierePasseA } from '../base/horloge-consolidation.ts';
import { confirmerLecon, contredireLecon, creerLecon, obtenirLecon } from '../base/lecons.ts';
import { ecrireCompetence, lireCompetence } from '../competences/depot-competences.ts';
import type { Competence } from '../types.ts';
import { executerConsolidation, INTERVALLE_MIN_MS, DELAI_DORMANCE_MS } from './consolidation.ts';
import { listerSauvegardes } from './sauvegarde.ts';

const PROJET = '/mnt/projects/exemple';
const T0 = new Date('2026-08-08T10:00:00Z').getTime();

let dossier: string;
let cheminDb: string;
let racineCompetences: string;
let racineSauvegardes: string;
let racineRapports: string;
let db: Database;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'ccremote-consolidation-'));
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

function entree(maintenant: number, aucuneMissionActive = true) {
  return { db, cheminDb, racineCompetences, racineSauvegardes, racineRapports, aucuneMissionActive, maintenant };
}

describe('executerConsolidation — portes (E10)', () => {
  test('première observation ⇒ horodatage SEMÉ, passe DIFFÉRÉE (pas de mutation, pas de rapport)', () => {
    expect(obtenirDernierePasseA(db)).toBeNull();
    const resultat = executerConsolidation(entree(T0));
    expect(resultat.executee).toBe(false);
    expect(resultat.motif).toContain('première observation');
    expect(resultat.rapportChemin).toBeNull();
    expect(obtenirDernierePasseA(db)).toBe(T0); // semé quand même
    expect(existsSync(racineSauvegardes)).toBe(false); // aucune sauvegarde : rien de mutant à protéger
  });

  test('moins de 7 jours depuis la dernière passe ⇒ refus', () => {
    executerConsolidation(entree(T0)); // sème
    const resultat = executerConsolidation(entree(T0 + INTERVALLE_MIN_MS - 1000));
    expect(resultat.executee).toBe(false);
    expect(resultat.motif).toContain('7 jours');
  });

  test('≥ 7 jours ⇒ la porte horloge s’ouvre (avec aucune mission active)', () => {
    executerConsolidation(entree(T0)); // sème
    const resultat = executerConsolidation(entree(T0 + INTERVALLE_MIN_MS));
    expect(resultat.executee).toBe(true);
  });

  test('une mission active sur la machine ⇒ refus, quelle que soit l’horloge', () => {
    executerConsolidation(entree(T0)); // sème
    const resultat = executerConsolidation(entree(T0 + INTERVALLE_MIN_MS, false));
    expect(resultat.executee).toBe(false);
    expect(resultat.motif).toContain('mission est active');
  });
});

describe('executerConsolidation — les quatre transitions par horloge (E10, C-4)', () => {
  test('candidate → active — filet de sécurité pour un état candidate/confirmations désynchronisé', () => {
    creerLecon(db, { id: 'l-promue', projet: PROJET, enonce: 'Une leçon.', categorie: 'outil', portee: 'projet' });
    // État volontairement forcé par SQL direct : `confirmerLecon` (C-5, E5) promeut déjà en
    // temps réel dès 2 confirmations, donc ce cas ne se produit jamais par l'API normale.
    // On le force ici pour prouver que la passe C-4 le rattrape quand même (filet de
    // sécurité, ex. données migrées ou désynchronisées), sans jamais le défaire (idempotent).
    db.query("UPDATE lecon SET confirmations = 2 WHERE id = 'l-promue'").run();
    executerConsolidation(entree(T0)); // sème
    const resultat = executerConsolidation(entree(T0 + INTERVALLE_MIN_MS));
    expect(resultat.executee).toBe(true);
    expect(resultat.transitions?.promues).toBeGreaterThanOrEqual(1);
    expect(obtenirLecon(db, 'l-promue')?.etat).toBe('active');
  });

  test('active → dormante après 60 jours sans confirmation', () => {
    creerLecon(db, {
      id: 'l-dormante',
      projet: PROJET,
      enonce: 'Une leçon qui va dormir.',
      categorie: 'methode',
      portee: 'projet',
      etat: 'active',
      creeeA: T0,
    });
    // `creerLecon` fixe `derniere_confirmation_a = creeeA` — vieille de plus de 60 jours au moment de la passe.
    executerConsolidation(entree(T0)); // sème
    const maintenant = T0 + DELAI_DORMANCE_MS + INTERVALLE_MIN_MS;
    const resultat = executerConsolidation(entree(maintenant));
    expect(resultat.executee).toBe(true);
    expect(resultat.transitions?.misesEnDormance).toBeGreaterThanOrEqual(1);
    expect(obtenirLecon(db, 'l-dormante')?.etat).toBe('dormante');
  });

  test('dormante → active sur nouvelle confirmation', () => {
    creerLecon(db, {
      id: 'l-reveil',
      projet: PROJET,
      enonce: 'Une leçon qui se réveille.',
      categorie: 'methode',
      portee: 'projet',
      etat: 'dormante',
      creeeA: T0,
    });
    executerConsolidation(entree(T0)); // sème
    const maintenant = T0 + INTERVALLE_MIN_MS;
    // Confirmation fraîche AVANT la passe (comme le ferait C-5 en temps réel à la clôture d’une mission).
    confirmerLecon(db, 'l-reveil', 'mission-y', 'preuve fraîche', maintenant - 1000);
    const resultat = executerConsolidation(entree(maintenant));
    expect(resultat.executee).toBe(true);
    expect(resultat.transitions?.reveillees).toBeGreaterThanOrEqual(1);
    expect(obtenirLecon(db, 'l-reveil')?.etat).toBe('active');
  });

  test('candidate → obsolete quand les contradictions rattrapent les confirmations (jamais supprimée)', () => {
    creerLecon(db, { id: 'l-perimee', projet: PROJET, enonce: 'Une leçon contestée.', categorie: 'piege', portee: 'projet' });
    contredireLecon(db, 'l-perimee', 'mission-z', 'preuve contraire', T0);
    executerConsolidation(entree(T0)); // sème
    const resultat = executerConsolidation(entree(T0 + INTERVALLE_MIN_MS));
    expect(resultat.executee).toBe(true);
    expect(resultat.transitions?.perimees).toBeGreaterThanOrEqual(1);
    const relue = obtenirLecon(db, 'l-perimee');
    expect(relue).not.toBeNull(); // `☠` la ligne reste
    expect(relue?.etat).toBe('obsolete');
    expect(relue?.enonce).toBe('Une leçon contestée.'); // texte intact, rien n’est effacé
  });
});

describe('executerConsolidation — artefact réel (E10, preuve 2/2)', () => {
  test('un rapport de passe Markdown réel est écrit, et la rotation des sauvegardes est visible sur disque', () => {
    // Sept mois de leçons pour peupler un rapport non trivial.
    creerLecon(db, { id: 'a1', projet: PROJET, enonce: 'Toujours démarrer Playwright avant de naviguer.', categorie: 'outil', portee: 'projet' });
    confirmerLecon(db, 'a1', 'mission-1', 'preuve', T0);
    const competence: Competence = {
      slug: 'reprise-worktree-git',
      nom: 'reprise-worktree-git',
      description: 'Reprendre un worktree laissé par une équipe précédente',
      portee: 'projet',
      projet: PROJET,
      etat: 'active',
      confirmations: 3,
      origine: [],
      maj: '2026-08-01',
    };
    ecrireCompetence(racineCompetences, { competence, corps: { quand: ['x'], etapes: ['y'], pieges: [] } });

    executerConsolidation(entree(T0)); // sème
    const resultat = executerConsolidation(entree(T0 + INTERVALLE_MIN_MS));
    expect(resultat.executee).toBe(true);
    expect(resultat.rapportChemin).not.toBeNull();
    if (resultat.rapportChemin === null) throw new Error('rapport attendu');

    const rapport = readFileSync(resultat.rapportChemin, 'utf8');
    console.log('--- Rapport de passe RÉEL (E10) ---\n' + rapport);
    expect(rapport).toContain('# Passe de consolidation');
    expect(rapport).toContain('## Sauvegarde');
    expect(rapport).toContain('## Transitions par horloge');
    expect(rapport).toContain('candidate → active');

    // La sauvegarde a bien été prise AVANT la mutation (E10 `☠`) : elle est sur le disque, datée.
    const sauvegardes = listerSauvegardes(racineSauvegardes);
    expect(sauvegardes.length).toBeGreaterThanOrEqual(1);
    console.log('--- Listing du dossier de sauvegardes (preuve E10) ---\n' + readdirSync(racineSauvegardes).join('\n'));
    expect(existsSync(join(racineSauvegardes, sauvegardes[0]!, 'apprentissage.db'))).toBe(true);

    // La compétence, elle, reste lisible (jamais supprimée) même sans fusion à opérer ici.
    expect(lireCompetence(racineCompetences, 'reprise-worktree-git')).not.toBeNull();
  });
});
