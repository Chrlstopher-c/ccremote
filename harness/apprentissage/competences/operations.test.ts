/**
 * Preuve E8 (1/2) : une opération inconnue est rejetée (liste des opérations acceptées dans
 * le message), un `slug` inexistant est rejeté, `creer` est refusé sous le seuil de trois
 * leçons `active` convergentes, et un `ajouter_piege` est appliqué au bon endroit du fichier
 * (PLAN-PORTAGE.md E8). La preuve 2/2 — l'artefact réel avant/après — est le dernier test de
 * ce fichier : il colle le contenu RÉEL du `COMPETENCE.md` produit par la boucle.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireCompetence } from './depot-competences.ts';
import { appliquerOperationCompetence, SEUIL_LECONS_CREATION, SEUIL_LECONS_PIEGE } from './operations.ts';
import { validerOperationCompetence } from '../extraction/garde-sortie.ts';
import type { CategorieLecon, Lecon, OperationCompetence } from '../types.ts';

const PROJET = '/mnt/projects/exemple';

let racine: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'ccremote-competences-'));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

function lecon(id: string, enonce: string, categorie: CategorieLecon = 'outil', etat: Lecon['etat'] = 'active'): Lecon {
  return {
    id,
    projet: PROJET,
    machine: null,
    enonce,
    categorie,
    portee: 'projet',
    etat,
    confirmations: 2,
    contradictions: 0,
    creeeA: Date.now(),
    derniereConfirmationA: Date.now(),
    servieCount: 0,
  };
}

// Vocabulaire délibérément recoupant (Playwright / démarrer / naviguer / ccremote) — un
// « groupe convergent » réel, pas trois leçons choisies au hasard (SPEC §5.8).
const LECONS_CONVERGENTES: readonly Lecon[] = [
  lecon('l1', 'Toujours démarrer Playwright avant de naviguer sur ccremote.'),
  lecon('l2', 'Playwright doit être démarré avant toute navigation sur ccremote.'),
  lecon('l3', 'Démarrer Playwright avant de naviguer évite un blocage silencieux sur ccremote.'),
];

const OPERATION_CREER: Extract<OperationCompetence, { type: 'creer' }> = {
  type: 'creer',
  nom: 'demarrage-playwright',
  description: 'Toujours démarrer Playwright avant de naviguer',
  quand: ['une navigation Playwright est requise dans la mission'],
  etapes: ['appeler browser_start avant tout browser_navigate', 'vérifier l’absence d’erreur de démarrage'],
};

describe('appliquerOperationCompetence — preuves de rejet (E8)', () => {
  test('une opération de forme inconnue est rejetée par la garde AVANT toute application, avec la liste des opérations acceptées', () => {
    // La garde (garde-sortie.ts) est le point de rejet réel — operations.ts ne reçoit jamais
    // de forme non conforme en usage normal (PLAN-PORTAGE.md E8 `☠`).
    const verdict = validerOperationCompetence('{"type": "supprimer", "slug": "demarrage-playwright"}');
    expect(verdict.accepte).toBe(false);
    if (!verdict.accepte) {
      expect(verdict.motif).toContain('supprimer');
      expect(verdict.motif).toContain('creer, ajouter_piege, ajouter_etape, rien');
    }
  });

  test('« rien » n’écrit jamais rien', () => {
    const resultat = appliquerOperationCompetence(
      { racine, projet: PROJET, leconsAppui: [] },
      { type: 'rien' },
    );
    expect(resultat.appliquee).toBe(false);
    expect(lireCompetence(racine, 'demarrage-playwright')).toBeNull();
  });

  test('un slug inexistant est rejeté pour ajouter_piege — aucune écriture', () => {
    const resultat = appliquerOperationCompetence(
      { racine, projet: PROJET, leconsAppui: [LECONS_CONVERGENTES[0]!] },
      { type: 'ajouter_piege', slug: 'competence-jamais-creee', ligne: 'un piège quelconque' },
    );
    expect(resultat.appliquee).toBe(false);
    if (!resultat.appliquee) expect(resultat.motif).toContain('introuvable');
    expect(lireCompetence(racine, 'competence-jamais-creee')).toBeNull();
  });

  test('un slug inexistant est rejeté pour ajouter_etape — aucune écriture', () => {
    const resultat = appliquerOperationCompetence(
      { racine, projet: PROJET, leconsAppui: [] },
      { type: 'ajouter_etape', slug: 'competence-jamais-creee', ligne: 'une étape', apresEtape: 0 },
    );
    expect(resultat.appliquee).toBe(false);
    if (!resultat.appliquee) expect(resultat.motif).toContain('introuvable');
  });

  test(`creer est refusé sous le seuil de ${SEUIL_LECONS_CREATION} leçons actives convergentes`, () => {
    const resultat = appliquerOperationCompetence(
      { racine, projet: PROJET, leconsAppui: LECONS_CONVERGENTES.slice(0, SEUIL_LECONS_CREATION - 1) },
      OPERATION_CREER,
    );
    expect(resultat.appliquee).toBe(false);
    if (!resultat.appliquee) expect(resultat.motif).toContain(String(SEUIL_LECONS_CREATION));
    expect(lireCompetence(racine, 'demarrage-playwright')).toBeNull();
  });

  test('creer est refusé si les leçons à l’appui ne partagent pas la même catégorie', () => {
    const melange = [LECONS_CONVERGENTES[0]!, LECONS_CONVERGENTES[1]!, lecon('l4', LECONS_CONVERGENTES[2]!.enonce, 'projet')];
    const resultat = appliquerOperationCompetence({ racine, projet: PROJET, leconsAppui: melange }, OPERATION_CREER);
    expect(resultat.appliquee).toBe(false);
    if (!resultat.appliquee) expect(resultat.motif).toContain('catégorie');
  });

  test('creer est refusé si les leçons à l’appui ne partagent pas de vocabulaire (pas de convergence réelle)', () => {
    const sansRapport = [
      lecon('a1', 'Toujours committer avant de migrer le schéma SQLite.'),
      lecon('a2', 'Le budget USD doit être vérifié avant de lancer une équipe.'),
      lecon('a3', 'Un worktree orphelin bloque le prochain dispatch de mission.'),
    ];
    const resultat = appliquerOperationCompetence({ racine, projet: PROJET, leconsAppui: sansRapport }, OPERATION_CREER);
    expect(resultat.appliquee).toBe(false);
    if (!resultat.appliquee) expect(resultat.motif).toContain('vocabulaire');
  });

  test(`ajouter_piege est refusé sous le seuil de ${SEUIL_LECONS_PIEGE} leçon active`, () => {
    appliquerOperationCompetence({ racine, projet: PROJET, leconsAppui: LECONS_CONVERGENTES }, OPERATION_CREER);
    const dormante = lecon('d1', 'Une leçon non active à l’appui.', 'outil', 'dormante');
    const resultat = appliquerOperationCompetence(
      { racine, projet: PROJET, leconsAppui: [dormante] },
      { type: 'ajouter_piege', slug: 'demarrage-playwright', ligne: 'piège refusé' },
    );
    expect(resultat.appliquee).toBe(false);
  });
});

describe('appliquerOperationCompetence — artefact réel produit par la boucle (E8, preuve 2/2)', () => {
  test('creer écrit un COMPETENCE.md réel, puis ajouter_piege le modifie AU BON ENDROIT — avant/après collés', () => {
    // --- AVANT : aucun fichier ---
    expect(lireCompetence(racine, 'demarrage-playwright')).toBeNull();

    // --- CRÉATION : trois leçons actives convergentes, exactement le seuil E8 ---
    const creation = appliquerOperationCompetence(
      { racine, projet: PROJET, leconsAppui: LECONS_CONVERGENTES, maintenant: '2026-08-08' },
      OPERATION_CREER,
    );
    expect(creation.appliquee).toBe(true);
    if (!creation.appliquee) throw new Error('création attendue');
    expect(creation.slug).toBe('demarrage-playwright');

    const cheminFichier = join(racine, 'demarrage-playwright', 'COMPETENCE.md');
    const avant = readFileSync(cheminFichier, 'utf8');
    expect(avant).toContain('nom: demarrage-playwright');
    expect(avant).toContain('etat: active');
    expect(avant).toContain('confirmations: 3');
    expect(avant).toContain('appeler browser_start avant tout browser_navigate');
    expect(avant).toContain('(aucun pour l’instant)');
    console.log('--- COMPETENCE.md AVANT ajouter_piege ---\n' + avant);

    // --- AJOUT D'UN PIÈGE : une seule leçon active suffit (E8) ---
    const piege = appliquerOperationCompetence(
      { racine, projet: PROJET, leconsAppui: [LECONS_CONVERGENTES[0]!], maintenant: '2026-08-09' },
      { type: 'ajouter_piege', slug: 'demarrage-playwright', ligne: 'browser_navigate sans browser_start échoue sans message clair' },
    );
    expect(piege.appliquee).toBe(true);

    const apres = readFileSync(cheminFichier, 'utf8');
    console.log('--- COMPETENCE.md APRÈS ajouter_piege ---\n' + apres);

    // Le piège est écrit dans la BONNE section, et rien d'autre ne bouge que « maj ».
    const sectionPieges = apres.slice(apres.indexOf('## Pièges déjà payés'));
    expect(sectionPieges).toContain('browser_navigate sans browser_start échoue sans message clair');
    expect(apres).toContain('appeler browser_start avant tout browser_navigate'); // étapes intactes
    expect(apres).toContain('confirmations: 3'); // confirmations de la création intactes
    expect(apres).toContain('maj: 2026-08-09'); // date mise à jour

    // Relecture typée : le dépôt retrouve exactement ce qui a été écrit.
    const relu = lireCompetence(racine, 'demarrage-playwright');
    expect(relu).not.toBeNull();
    if (relu !== null) {
      expect(relu.corps.pieges).toEqual(['browser_navigate sans browser_start échoue sans message clair']);
      expect(relu.corps.etapes).toHaveLength(2);
    }
  });
});
