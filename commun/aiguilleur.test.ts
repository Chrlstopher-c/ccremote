import { describe, expect, test } from 'bun:test';
import type { MessageDeAiguilleur } from './aiguilleur.ts';
import {
  analyserDeAiguilleur,
  analyserVersAiguilleur,
  LIMITE_CHARGE_OCTETS,
  MOTIFS_ERREUR,
  VALIDE_CANAL,
  VALIDE_IDENTIFIANT,
} from './aiguilleur.ts';

const ID = 'a1b2c3d4e5f6';

describe('messages d’un membre vers l’aiguilleur', () => {
  test('ouvrir, accepter, refuser, transmettre et fermer un canal', () => {
    expect(analyserVersAiguilleur({ t: 'ouvrir', canal: 'c1', vers: ID })?.t).toBe('ouvrir');
    expect(analyserVersAiguilleur({ t: 'accepter', canal: 'c1' })?.t).toBe('accepter');
    expect(analyserVersAiguilleur({ t: 'refuser', canal: 'c1' })?.t).toBe('refuser');
    expect(analyserVersAiguilleur({ t: 'donnees', canal: 'c1', charge: 'opaque' })?.t).toBe('donnees');
    expect(analyserVersAiguilleur({ t: 'fermer', canal: 'c1' })?.t).toBe('fermer');
  });

  test('un message inconnu ou mal formé est refusé', () => {
    expect(analyserVersAiguilleur({ t: 'inconnu', canal: 'c1' })).toBeNull();
    expect(analyserVersAiguilleur({ t: 'ouvrir', canal: 'c1', vers: 'PAS-UN-ID' })).toBeNull();
    expect(analyserVersAiguilleur({ t: 'donnees', canal: 'c 1', charge: 'x' })).toBeNull();
    expect(analyserVersAiguilleur({ t: 'donnees', canal: 'c1', charge: 42 })).toBeNull();
    expect(analyserVersAiguilleur('chaîne')).toBeNull();
    expect(analyserVersAiguilleur(null)).toBeNull();
  });

  test('un membre ne peut pas envoyer les messages réservés à l’aiguilleur', () => {
    expect(analyserVersAiguilleur({ t: 'presence', membres: [] })).toBeNull();
    expect(analyserVersAiguilleur({ t: 'erreur', motif: 'non-autorise' })).toBeNull();
  });

  test('la charge est une chaîne opaque, jamais interprétée', () => {
    const charge = '{"pas":"du json"}\u0000 ÿ base64url==';
    expect(analyserVersAiguilleur({ t: 'donnees', canal: 'c1', charge })).toEqual({
      t: 'donnees',
      canal: 'c1',
      charge,
    });
  });
});

describe('messages de l’aiguilleur vers un membre', () => {
  test('demande entrante, décisions relayées, données, fermeture', () => {
    expect(analyserDeAiguilleur({ t: 'ouvrir', canal: 'c1', de: ID })?.t).toBe('ouvrir');
    expect(analyserDeAiguilleur({ t: 'accepter', canal: 'c1' })?.t).toBe('accepter');
    expect(analyserDeAiguilleur({ t: 'refuser', canal: 'c1' })?.t).toBe('refuser');
    expect(analyserDeAiguilleur({ t: 'donnees', canal: 'c1', charge: 'x' })?.t).toBe('donnees');
    expect(analyserDeAiguilleur({ t: 'fermer', canal: 'c1' })?.t).toBe('fermer');
  });

  test('la présence porte l’état et, en plus, nom, genre et propriétaire ; ces champs sont optionnels', () => {
    const complete: MessageDeAiguilleur = {
      t: 'presence',
      proprietaire: 'chris',
      membres: [{ id: ID, enLigne: true, nom: 'tour', genre: 'noeud', proprietaire: 'chris' }],
    };
    expect(analyserDeAiguilleur(complete)).toEqual(complete);
    expect(analyserDeAiguilleur({ t: 'presence', membres: [{ id: ID, enLigne: true }] })).not.toBeNull();
  });

  test('un champ inconnu reste refusé, y compris à côté des nouveaux champs', () => {
    expect(analyserDeAiguilleur({ t: 'presence', membres: [{ id: ID, enLigne: true, couleur: 'x' }] })).toBeNull();
    expect(analyserDeAiguilleur({ t: 'presence', membres: [], couleur: 'x' })).toBeNull();
    expect(analyserDeAiguilleur({ t: 'ouvrir', canal: 'c1', de: ID, proprietaire: 'chris', couleur: 'x' })).toBeNull();
  });

  test('un genre hors liste est refusé', () => {
    expect(analyserDeAiguilleur({ t: 'presence', membres: [{ id: ID, enLigne: true, genre: 'robot' }] })).toBeNull();
  });

  test('ouvrir porte le propriétaire de l’ouvrant, optionnel pour un aiguilleur ancien', () => {
    expect(analyserDeAiguilleur({ t: 'ouvrir', canal: 'c1', de: ID, proprietaire: 'chris' })).toEqual({
      t: 'ouvrir',
      canal: 'c1',
      de: ID,
      proprietaire: 'chris',
    });
    expect(analyserDeAiguilleur({ t: 'ouvrir', canal: 'c1', de: ID })?.t).toBe('ouvrir');
  });

  test('une erreur porte un motif de la liste fermée', () => {
    expect(analyserDeAiguilleur({ t: 'erreur', canal: 'c1', motif: 'non-autorise' })?.t).toBe('erreur');
    expect(analyserDeAiguilleur({ t: 'erreur', motif: 'motif-libre' })).toBeNull();
  });
});

describe('bornes du protocole', () => {
  test('les motifs d’erreur sont une liste fermée qui couvre les refus prévus', () => {
    expect(MOTIFS_ERREUR).toContain('non-autorise');
    expect(MOTIFS_ERREUR).toContain('charge-trop-grande');
    expect(MOTIFS_ERREUR).toContain('hors-ligne');
  });

  test('identifiants de membre et canaux sont bornés', () => {
    expect(VALIDE_IDENTIFIANT.test(ID)).toBe(true);
    expect(VALIDE_IDENTIFIANT.test('ID-MAJUSCULE')).toBe(false);
    expect(VALIDE_CANAL.test('c'.repeat(64))).toBe(true);
    expect(VALIDE_CANAL.test('c'.repeat(65))).toBe(false);
  });

  test('la charge est limitée à 1 Mio', () => {
    expect(LIMITE_CHARGE_OCTETS).toBe(1024 * 1024);
  });
});
