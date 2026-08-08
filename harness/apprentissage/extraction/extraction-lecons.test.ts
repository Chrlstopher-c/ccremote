/**
 * Preuve E5 (C-3) : la passe d'extraction compose le prompt, appelle le client, passe la
 * garde, et applique le filtre déterministe de la liste négative — jamais d'exception.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { describe, expect, test } from 'bun:test';
import type { ClientInference, ReponseModele } from './client-inference.ts';
import { extraireLecons, respecteListeNegative } from './extraction-lecons.ts';
import type { ResumeMission } from '../types.ts';

const RESUME: ResumeMission = {
  missionId: 'mission-x',
  sessionId: 'session-x',
  projet: '/mnt/projects/exemple',
  mandatResume: 'Corriger un défaut de synchronisation.',
  critereArret: 'Tests verts.',
  issue: 'livree',
  dureeMs: 60_000,
  nbTours: 4,
  outils: [],
  erreurs: [],
  fichiersTouches: [],
  commandesEchouees: [],
  sousAgents: [],
  extraitFinal: 'Corrigé et vérifié.',
};

function clientQuiRepond(contenu: string): ClientInference {
  return { appelerModele: async () => ({ disponible: true, contenu }) };
}

function clientIndisponible(motif: string): ClientInference {
  return { appelerModele: async (): Promise<ReponseModele> => ({ disponible: false, motif }) };
}

describe('respecteListeNegative (E5, filtre déterministe)', () => {
  test('rejette un énoncé qui nomme une date', () => {
    const resultat = respecteListeNegative({
      enonce: 'Le bug du 2026-08-04 vient d’une race condition.',
      categorie: 'piege',
      portee: 'projet',
      preuve: 'x',
      doublonDe: null,
    });
    expect(resultat.ok).toBe(false);
  });

  test('rejette un énoncé qui nomme une branche equipe/<uuid>', () => {
    const resultat = respecteListeNegative({
      enonce: 'Sur equipe/4c7bd03b-d1f5-447e-bbd3-7998496afd49 le merge a échoué.',
      categorie: 'piege',
      portee: 'projet',
      preuve: 'x',
      doublonDe: null,
    });
    expect(resultat.ok).toBe(false);
  });

  test('rejette une négation sur un outil en tête d’énoncé', () => {
    const resultat = respecteListeNegative({
      enonce: 'Playwright ne fonctionne pas sur ce projet.',
      categorie: 'outil',
      portee: 'projet',
      preuve: 'x',
      doublonDe: null,
    });
    expect(resultat.ok).toBe(false);
  });

  test('accepte un énoncé générique, réutilisable, sans identifiant', () => {
    const resultat = respecteListeNegative({
      enonce: 'Toujours committer avant de lancer une migration de schéma.',
      categorie: 'methode',
      portee: 'projet',
      preuve: 'x',
      doublonDe: null,
    });
    expect(resultat.ok).toBe(true);
  });
});

describe('extraireLecons (E5, C-3)', () => {
  test('modèle indisponible ⇒ liste vide, erreur renseignée, jamais d’exception', async () => {
    const resultat = await extraireLecons(clientIndisponible('ECONNREFUSED'), RESUME, []);
    expect(resultat.lecons).toHaveLength(0);
    expect(resultat.erreur).toContain('ECONNREFUSED');
  });

  test('sortie non-JSON ⇒ liste vide, erreur renseignée (garde de sortie)', async () => {
    const resultat = await extraireLecons(clientQuiRepond('ceci n’est pas du JSON'), RESUME, []);
    expect(resultat.lecons).toHaveLength(0);
    expect(resultat.erreur).not.toBeNull();
  });

  test('sortie valide ⇒ leçons rendues telles quelles', async () => {
    const contenu = JSON.stringify([
      {
        enonce: 'Toujours lire un artefact réel avant de conclure.',
        categorie: 'methode',
        portee: 'projet',
        preuve: 'observé sur cette mission',
        doublonDe: null,
      },
    ]);
    const resultat = await extraireLecons(clientQuiRepond(contenu), RESUME, []);
    expect(resultat.erreur).toBeNull();
    expect(resultat.lecons).toHaveLength(1);
    expect(resultat.lecons[0]?.enonce).toBe('Toujours lire un artefact réel avant de conclure.');
  });

  test('leçon valide mais hors liste négative ⇒ filtrée avant de sortir', async () => {
    const contenu = JSON.stringify([
      {
        enonce: 'Toujours lire un artefact réel avant de conclure.',
        categorie: 'methode',
        portee: 'projet',
        preuve: 'x',
        doublonDe: null,
      },
      {
        enonce: 'Bash ne marche pas sur cette machine.',
        categorie: 'outil',
        portee: 'projet',
        preuve: 'x',
        doublonDe: null,
      },
    ]);
    const resultat = await extraireLecons(clientQuiRepond(contenu), RESUME, []);
    expect(resultat.lecons).toHaveLength(1);
    expect(resultat.motifsRejetes).toHaveLength(1);
  });
});
