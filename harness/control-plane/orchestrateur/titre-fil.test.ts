/**
 * `☠` Ces tests portent sur la SEULE chose qui distingue une consigne d'une
 * garantie : le refus. Qu'un titre valide passe n'apprend rien — ce qui compte,
 * c'est qu'un deuxième nommage automatique soit impossible, et qu'une demande
 * explicite de Chris le reste toujours.
 */

import { describe, expect, test } from 'bun:test';
import { consigneNommage, MESSAGES_AVANT_NOMMAGE, normaliserTitre, TITRE_MAX, verdictNommage } from './titre-fil.ts';

const FRAIS = { source: 'defaut' as const, messagesOperateur: MESSAGES_AVANT_NOMMAGE };

describe('normaliserTitre', () => {
  test('retire l’emballage que les modèles écrivent spontanément', () => {
    expect(normaliserTitre('  "Refonte de la sidebar"  ')).toBe('Refonte de la sidebar');
    expect(normaliserTitre('« Migration du registre »')).toBe('Migration du registre');
    expect(normaliserTitre('Audit des quotas :')).toBe('Audit des quotas');
  });

  test('écrase les espaces multiples et les retours ligne', () => {
    expect(normaliserTitre('Refonte\n  de   la\tsidebar')).toBe('Refonte de la sidebar');
  });

  test('borne la longueur', () => {
    expect(normaliserTitre('x'.repeat(400)).length).toBe(TITRE_MAX);
  });
});

describe('verdictNommage — nommage automatique', () => {
  test('un fil jamais nommé, au deuxième message, accepte', () => {
    const v = verdictNommage(FRAIS, 'Refonte de la sidebar', false);
    expect(v.ok).toBe(true);
    expect(v.titre).toBe('Refonte de la sidebar');
  });

  test('☠ au premier message, refuse — et dit quoi attendre', () => {
    const v = verdictNommage({ source: 'defaut', messagesOperateur: 1 }, 'Bonjour', false);
    expect(v.ok).toBe(false);
    expect(v.raison).toContain('message');
  });

  test('☠ LE cas qui compte : un fil déjà nommé automatiquement ne se renomme pas', () => {
    // Sans cette borne, un modèle qui trouve un meilleur titre au trentième tour
    // le pose — et le fil que Chris cherchait dans sa liste a changé de nom.
    const v = verdictNommage({ source: 'auto', messagesOperateur: 12 }, 'Un bien meilleur titre', false);
    expect(v.ok).toBe(false);
    expect(v.raison).toContain('demande_par_chris');
  });

  test('☠ un titre posé à la main par Chris est intouchable sans sa demande', () => {
    const v = verdictNommage({ source: 'manuel', messagesOperateur: 40 }, 'Titre du modèle', false);
    expect(v.ok).toBe(false);
  });

  test('un titre vide ou réduit à de la ponctuation est refusé', () => {
    expect(verdictNommage(FRAIS, '   ', false).ok).toBe(false);
    expect(verdictNommage(FRAIS, '"  "', false).ok).toBe(false);
  });

  test('☠ le libellé d’attente n’est pas un titre', () => {
    // Un modèle qui « confirme » le titre courant reverrouillerait le fil sur
    // « Nouvelle conversation » pour toute la session.
    expect(verdictNommage(FRAIS, 'Nouvelle conversation', false).ok).toBe(false);
  });
});

describe('verdictNommage — demande explicite de Chris', () => {
  test('passe sur un fil déjà nommé automatiquement', () => {
    const v = verdictNommage({ source: 'auto', messagesOperateur: 9 }, 'Titre voulu par Chris', true);
    expect(v.ok).toBe(true);
  });

  test('passe sur un fil déjà nommé à la main', () => {
    expect(verdictNommage({ source: 'manuel', messagesOperateur: 9 }, 'Encore un autre', true).ok).toBe(true);
  });

  test('passe même au tout premier message', () => {
    expect(verdictNommage({ source: 'defaut', messagesOperateur: 0 }, 'Titre imposé', true).ok).toBe(true);
  });

  test('☠ mais ne dispense JAMAIS de la validité du titre', () => {
    // La demande de Chris lève la garde d'usage, pas la garde de forme : un
    // titre vide écrit dans la base ferait disparaître le fil de sa liste.
    expect(verdictNommage({ source: 'auto', messagesOperateur: 9 }, '   ', true).ok).toBe(false);
  });
});

describe('consigneNommage — le rappel joint au message', () => {
  test('☠ présent dès le deuxième message tant que le fil est anonyme', () => {
    // Sans lui, mesuré le 01/08 : outil exposé, consigne écrite dans le mandat,
    // et aucun fil nommé. Une règle qui n'arrive pas au moment où elle
    // s'applique ne s'applique pas.
    expect(consigneNommage({ source: 'defaut', messagesOperateur: 2 })).toContain('nommer_fil');
  });

  test('absent au premier message', () => {
    expect(consigneNommage({ source: 'defaut', messagesOperateur: 1 })).toBeNull();
  });

  test('☠ s’éteint dès que le titre existe — sinon il pousserait au renommage', () => {
    expect(consigneNommage({ source: 'auto', messagesOperateur: 5 })).toBeNull();
    expect(consigneNommage({ source: 'manuel', messagesOperateur: 5 })).toBeNull();
  });

  test('reste tant que le modèle l’ignore : le rappel est réémis au tour suivant', () => {
    expect(consigneNommage({ source: 'defaut', messagesOperateur: 7 })).not.toBeNull();
  });
});
