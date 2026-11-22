import { beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirAnnuaire } from './annuaire-base.ts';
import { Annuaire } from './annuaire.ts';
import { executerCommande } from './commande.ts';

const FORME_CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;
let annuaire: Annuaire;

beforeEach(() => {
  annuaire = new Annuaire(ouvrirAnnuaire(':memory:'));
});

function membreEnBase(id: string): { revoqueLe: string | null } {
  const m = annuaire.membre(id);
  if (!m) throw new Error('membre absent');
  return m;
}

describe('commandes locales de l’aiguilleur', () => {
  test('appairer affiche un code de forme XXXX-XXXX, valable 10 minutes, usage unique', () => {
    const sortie = executerCommande(['appairer', 'chris'], annuaire);
    expect(sortie.split('\n')[0]).toMatch(FORME_CODE);
    expect(sortie).toContain('usage unique');
  });

  test('appairer refuse un propriétaire mal formé', () => {
    expect(() => executerCommande(['appairer', ''], annuaire)).toThrow();
    expect(() => executerCommande(['appairer', 'Chris Maj'], annuaire)).toThrow();
  });

  test('membres liste les membres sans jeton ni clé', () => {
    annuaire.creerMembre({
      id: 'a1b2c3d4e5f6',
      genre: 'noeud',
      nom: 'tour',
      proprietaire: 'chris',
      empreinteCle: 'e'.repeat(64),
      jetonEmpreinte: 'f'.repeat(64),
      sansEcran: false,
    });
    const sortie = executerCommande(['membres'], annuaire);
    expect(sortie).toContain('a1b2c3d4e5f6');
    expect(sortie).toContain('chris');
    expect(sortie).not.toContain('f'.repeat(64));
  });

  test('revoquer coupe un membre une fois, refuse un identifiant inconnu', () => {
    annuaire.creerMembre({
      id: 'a1b2c3d4e5f6',
      genre: 'appareil',
      nom: 'iphone',
      proprietaire: 'chris',
      empreinteCle: 'e'.repeat(64),
      sansEcran: false,
      jetonEmpreinte: 'f'.repeat(64),
    });
    expect(() => executerCommande(['revoquer', '000000000000'], annuaire)).toThrow();
    expect(executerCommande(['revoquer', 'a1b2c3d4e5f6'], annuaire)).toContain('révoqué');
    expect(membreEnBase('a1b2c3d4e5f6').revoqueLe).not.toBeNull();
    expect(() => executerCommande(['revoquer', 'a1b2c3d4e5f6'], annuaire)).toThrow();
  });

  test('lier-duo lie deux propriétaires distincts, dans un sens comme dans l’autre', () => {
    executerCommande(['lier-duo', 'matheo', 'chris'], annuaire);
    expect(annuaire.duoLie('chris', 'matheo')).toBe(true);
    expect(annuaire.duoLie('matheo', 'chris')).toBe(true);
    expect(() => executerCommande(['lier-duo', 'chris', 'chris'], annuaire)).toThrow();
    expect(() => executerCommande(['lier-duo', 'chris'], annuaire)).toThrow();
  });

  test('une commande inconnue rend l’aide', () => {
    expect(() => executerCommande(['inconnue'], annuaire)).toThrow(/usage/);
  });
});
