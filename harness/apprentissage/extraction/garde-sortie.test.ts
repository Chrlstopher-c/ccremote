/**
 * Preuve E4 (1/2) : la garde de sortie accepte le valide, rejette le hors-domaine, le JSON
 * tronqué et le texte libre — et chaque rejet liste les valeurs acceptées (PLAN-PORTAGE.md, E4 ;
 * code-standards.md « Model output is untrusted input »).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { describe, expect, test } from 'bun:test';
import { validerLeconExtraite, validerLeconsExtraites } from './garde-sortie.ts';

const LECON_VALIDE = JSON.stringify({
  enonce: 'Toujours lire un artefact réel avant de conclure.',
  categorie: 'methode',
  portee: 'projet',
  preuve: 'extrait du ResumeMission',
  doublonDe: null,
});

describe('validerLeconExtraite (E4)', () => {
  test('une sortie valide est acceptée', () => {
    const resultat = validerLeconExtraite(LECON_VALIDE);
    expect(resultat.accepte).toBe(true);
    if (resultat.accepte) {
      expect(resultat.valeur.enonce).toBe('Toujours lire un artefact réel avant de conclure.');
      expect(resultat.valeur.categorie).toBe('methode');
    }
  });

  test('portee: "univers" est rejetée, et le message liste les valeurs acceptées', () => {
    const brut = JSON.stringify({
      enonce: 'Une leçon.',
      categorie: 'outil',
      portee: 'univers',
      preuve: 'preuve',
      doublonDe: null,
    });
    const resultat = validerLeconExtraite(brut);
    expect(resultat.accepte).toBe(false);
    if (!resultat.accepte) {
      expect(resultat.motif).toContain('univers');
      expect(resultat.motif).toContain('projet');
      expect(resultat.motif).toContain('machine');
      expect(resultat.motif).toContain('global');
    }
  });

  test('categorie hors domaine est rejetée avec les valeurs acceptées', () => {
    const brut = JSON.stringify({
      enonce: 'Une leçon.',
      categorie: 'divertissement',
      portee: 'projet',
      preuve: 'preuve',
      doublonDe: null,
    });
    const resultat = validerLeconExtraite(brut);
    expect(resultat.accepte).toBe(false);
    if (!resultat.accepte) {
      expect(resultat.motif).toContain('outil');
      expect(resultat.motif).toContain('methode');
      expect(resultat.motif).toContain('piege');
    }
  });

  test('JSON tronqué est rejeté', () => {
    const resultat = validerLeconExtraite('{"enonce": "Leçon incomplète');
    expect(resultat.accepte).toBe(false);
    if (!resultat.accepte) expect(resultat.motif).toContain('tronqué');
  });

  test('texte libre (pas du JSON) est rejeté', () => {
    const resultat = validerLeconExtraite('Voici ce que je pense de cette mission, en prose.');
    expect(resultat.accepte).toBe(false);
  });

  test('un tableau JSON à la racine est rejeté (schéma attendu = un objet)', () => {
    const resultat = validerLeconExtraite('[]');
    expect(resultat.accepte).toBe(false);
  });

  test('une balise Markdown ```json autour du JSON est dépouillée avant validation (E5, artefact réel)', () => {
    // ☠ Constaté sur artefact réel (banc `apprentissage-inference-reel.ts`) : Haiku 4.5
    // enveloppe sa sortie malgré la consigne du prompt. Ne relâche rien : le contenu est
    // toujours parsé et validé strictement APRÈS le dépouillement.
    const resultat = validerLeconExtraite(`\`\`\`json\n${LECON_VALIDE}\n\`\`\``);
    expect(resultat.accepte).toBe(true);
  });

  test('énoncé au-delà de 200 caractères est rejeté', () => {
    const brut = JSON.stringify({
      enonce: 'x'.repeat(201),
      categorie: 'outil',
      portee: 'projet',
      preuve: 'preuve',
      doublonDe: null,
    });
    const resultat = validerLeconExtraite(brut);
    expect(resultat.accepte).toBe(false);
    if (!resultat.accepte) expect(resultat.motif).toContain('200');
  });

  test('doublonDe accepte une chaîne ou null, rejette un nombre', () => {
    const brut = JSON.stringify({
      enonce: 'Une leçon.',
      categorie: 'outil',
      portee: 'projet',
      preuve: 'preuve',
      doublonDe: 42,
    });
    const resultat = validerLeconExtraite(brut);
    expect(resultat.accepte).toBe(false);
  });
});

describe('validerLeconsExtraites — le tableau réellement servi par le modèle (E4)', () => {
  test('un tableau vide est accepté (0 leçon)', () => {
    const resultat = validerLeconsExtraites('[]');
    expect(resultat.accepte).toBe(true);
    if (resultat.accepte) expect(resultat.valeur).toHaveLength(0);
  });

  test('un tableau de leçons valides est accepté', () => {
    const resultat = validerLeconsExtraites(`[${LECON_VALIDE}]`);
    expect(resultat.accepte).toBe(true);
    if (resultat.accepte) expect(resultat.valeur).toHaveLength(1);
  });

  test('plus de 3 leçons est rejeté', () => {
    const resultat = validerLeconsExtraites(`[${LECON_VALIDE},${LECON_VALIDE},${LECON_VALIDE},${LECON_VALIDE}]`);
    expect(resultat.accepte).toBe(false);
    if (!resultat.accepte) expect(resultat.motif).toContain('3');
  });

  test('une leçon invalide dans le tableau rejette le tableau entier', () => {
    const invalide = JSON.stringify({ enonce: 'x', categorie: 'outil', portee: 'univers', preuve: 'p', doublonDe: null });
    const resultat = validerLeconsExtraites(`[${LECON_VALIDE},${invalide}]`);
    expect(resultat.accepte).toBe(false);
    if (!resultat.accepte) expect(resultat.motif).toContain('#1');
  });

  test('un tableau enveloppé de balises Markdown est dépouillé avant validation (E5, artefact réel)', () => {
    const resultat = validerLeconsExtraites(`\`\`\`json\n[${LECON_VALIDE}]\n\`\`\``);
    expect(resultat.accepte).toBe(true);
    if (resultat.accepte) expect(resultat.valeur).toHaveLength(1);
  });
});
