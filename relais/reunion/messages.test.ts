import { describe, expect, test } from 'bun:test';
import { LONGUEUR_REPONSE_REUNION } from '../../commun/reunion.ts';
import { cumulerReponse, enveloppeDemande, sujetDepuis } from './messages.ts';

describe('sujetDepuis', () => {
  test('prend la première ligne et la tronque à 60 caractères', () => {
    expect(sujetDepuis('Première ligne\nseconde')).toBe('Première ligne');
    expect(sujetDepuis('a'.repeat(80))).toBe(`${'a'.repeat(60)}…`);
  });

  test('un message vide donne un sujet par défaut', () => {
    expect(sujetDepuis('   ')).toBe('Réunion');
  });
});

describe('enveloppeDemande', () => {
  test('attribue la demande à l’utilisateur et rappelle les garde-fous', () => {
    const texte = enveloppeDemande('Facturation', 'Bonjour');
    expect(texte.startsWith('[Réunion — de l’utilisateur] Bonjour')).toBe(true);
    expect(texte).toContain('« Facturation »');
    expect(texte).toContain('quart_*');
    expect(texte).toContain('pentest');
    expect(texte).toContain('validation de l’utilisateur');
  });
});

describe('cumulerReponse', () => {
  test('la première réponse est reprise telle quelle, les suivantes s ajoutent', () => {
    expect(cumulerReponse(null, 'un')).toBe('un');
    expect(cumulerReponse('un', 'deux')).toBe('un\n\ndeux');
  });

  test('le total ne dépasse jamais la borne, troncature signalée par …', () => {
    const long = cumulerReponse(null, 'x'.repeat(LONGUEUR_REPONSE_REUNION + 500));
    expect(long.length).toBe(LONGUEUR_REPONSE_REUNION);
    expect(long.endsWith('…')).toBe(true);
    expect(cumulerReponse(long, 'suite').length).toBe(LONGUEUR_REPONSE_REUNION);
  });
});
