import { describe, expect, test } from 'bun:test';
import { annonceSaturation, fenetreEncoreSaturante } from './saturation-compte.ts';

describe('saturation d’un compte — formes RÉELLEMENT reçues du CLI', () => {
  test('☠ « weekly limit » — la forme vue en prod le 23/07, qu’AUCUN motif n’attrapait', () => {
    expect(annonceSaturation("You've hit your weekly limit · resets Jul 26, 9pm (Europe/Paris)")).toBe(true);
  });

  test('« monthly spend limit »', () => {
    expect(annonceSaturation("You've hit your monthly spend limit")).toBe(true);
  });

  test('« quota exceeded » reste couvert', () => {
    expect(annonceSaturation('quota exceeded for this organization')).toBe(true);
  });

  test('☠ RENVERSEMENT ASSUMÉ (01/08) : « rate limit » n’est PLUS un motif', () => {
    // Ce test attendait `true`. Le motif était SPÉCULATIF — jamais vu dans une
    // annonce réelle du CLI — et c'est la tournure la plus banale du métier.
    // Mesuré en production : l'orchestrateur décrivant StockIOP a écrit
    // « Production readiness bouclée (rate limiting, security headers…) » et
    // s'est déclaré saturé lui-même, sur un compte à 35 %.
    // Un test qui redeviendrait `true` ici ne signale PAS une régression.
    expect(annonceSaturation('rate limit reached')).toBe(false);
  });

  test('☠ le marqueur machine du CLI l’emporte sur toute autre règle', () => {
    // Signature relevée sur les DEUX saturations réelles. Ce paramètre de suivi
    // est émis par le CLI, jamais écrit par un modèle qui parle de quotas.
    const reel = "You've hit your monthly spend limit · raise it at claude.ai/settings/usage?from=cc_cli_limit_message";
    expect(annonceSaturation(reel)).toBe(true);
    // Même noyé dans un long texte : la signature machine ne ment pas.
    expect(annonceSaturation(`${'x'.repeat(2000)} ${reel}`)).toBe(true);
  });

  test('formulation française', () => {
    expect(annonceSaturation('Vous avez atteint votre limite de dépense')).toBe(true);
  });
});

describe('saturation — ce qui n’en est PAS une', () => {
  test('☠ un AVERTISSEMENT à 80 % n’écarte pas le compte (panne #16)', () => {
    expect(annonceSaturation("You've used 80% of your five-hour limit.")).toBe(false);
  });

  test('texte ordinaire mentionnant une limite sans l’atteindre', () => {
    expect(annonceSaturation('Je vais limiter la portée de cette analyse.')).toBe(false);
    expect(annonceSaturation('')).toBe(false);
  });

  test('☠ LE FAUX POSITIF DU 01/08 — une PROSE qui parle de limites n’en est pas une', () => {
    // Texte réel, relu en base (conversation aa66c851, 2003 caractères). Chris
    // demande « où en est StockIOP ? », obtient une bonne réponse, et voit
    // « Compte saturé — renvoie ton message » avec un compte à 35 %. Le
    // détecteur lisait le texte que le modèle produit LUI-MÊME comme un signal
    // de contrôle — sur un projet dont le sujet est justement les quotas d'API.
    const reponse = `Voilà où en est StockIOP, d'après ses docs de suivi. ${'Contexte. '.repeat(60)}
      ## Niveau de maturité : bien au-delà du MVP
      - **Production readiness** bouclée (rate limiting, security headers, structlog,
        health check, refresh token rotation, tests) dès avril 2026.
      ${'Suite du rapport. '.repeat(40)}`;
    expect(reponse.length).toBeGreaterThan(400);
    expect(annonceSaturation(reponse)).toBe(false);
  });

  test('☠ un long texte citant une VRAIE annonce sans sa signature reste ignoré', () => {
    // Coût assumé : une détection manquée fait renvoyer un message, avec
    // l'annonce du CLI sous les yeux. Un faux positif tue la session, fait
    // tourner le compte maître et fait réécrire l'opérateur.
    const prose = `${'Analyse. '.repeat(60)} le compte a hit your weekly limit hier soir.`;
    expect(prose.length).toBeGreaterThan(400);
    expect(annonceSaturation(prose)).toBe(false);
  });

  test('une annonce COURTE sans signature reste détectée', () => {
    expect(annonceSaturation("You've hit your weekly limit · resets Jul 26, 9pm")).toBe(true);
  });
});

describe('une saturation ne survit pas à sa fenêtre', () => {
  const MAINTENANT = 1_700_000_000_000;

  test('☠ VÉCU 26→31/07 — reset PASSÉ : le verdict est caduc, le compte redevient disponible', () => {
    expect(fenetreEncoreSaturante({ statut: 'rejected', resetA: MAINTENANT - 1 }, MAINTENANT)).toBe(false);
  });

  test('reset à VENIR : la saturation tient', () => {
    expect(fenetreEncoreSaturante({ statut: 'rejected', resetA: MAINTENANT + 60_000 }, MAINTENANT)).toBe(true);
  });

  test('☠ fin de fenêtre INCONNUE : on ne relâche pas — inconnu ≠ expiré', () => {
    expect(fenetreEncoreSaturante({ statut: 'rejected', resetA: null }, MAINTENANT)).toBe(true);
  });

  test('un quota non rejeté n’écarte rien, reset passé ou non', () => {
    expect(fenetreEncoreSaturante({ statut: 'allowed', resetA: null }, MAINTENANT)).toBe(false);
    expect(fenetreEncoreSaturante({ statut: 'allowed_warning', resetA: MAINTENANT + 1 }, MAINTENANT)).toBe(false);
  });
});
