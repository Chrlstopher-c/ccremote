// Poignée directe : un défi signé par l'identité annoncée, vérifiable ; une signature altérée ou un défi d'un autre
// échange est refusé. Pur (aucune connexion).
import { describe, expect, test } from 'bun:test';
import { genererIdentite } from '../../commun/chiffrement/identite.ts';
import {
  composerAccueil,
  composerBonjour,
  defiAleatoire,
  identifiantDerive,
  type Locale,
  verifierAccueil,
  verifierBonjour,
} from './direct-poignee.ts';

async function locale(id: string, nom: string): Promise<Locale> {
  return { id, identite: await genererIdentite(), nom, proprietaire: 'essai' };
}

describe('poignée directe', () => {
  test('le bonjour et l’accueil se vérifient ; l’identité prouvée est celle de l’émetteur', async () => {
    const a = await locale('aaaaaaaaaaaa', 'tour');
    const b = await locale('bbbbbbbbbbbb', 'portable');
    const defiB = defiAleatoire();
    const defiA = defiAleatoire();
    const bonjour = await composerBonjour(a, defiB, defiA);
    const verifie = await verifierBonjour(JSON.parse(JSON.stringify(bonjour)), defiB);
    expect(verifie?.presentation.id).toBe('aaaaaaaaaaaa');
    expect(verifie?.presentation.nom).toBe('tour');
    expect(verifie?.defi).toBe(defiA);
    const accueil = await composerAccueil(b, defiA);
    const pair = await verifierAccueil(JSON.parse(JSON.stringify(accueil)), defiA);
    expect(pair?.id).toBe('bbbbbbbbbbbb');
    expect(pair?.proprietaire).toBe('essai');
  });

  test('un défi qui n’est pas celui du répondeur est refusé (rejeu)', async () => {
    const a = await locale('aaaaaaaaaaaa', 'tour');
    const bonjour = await composerBonjour(a, defiAleatoire(), defiAleatoire());
    expect(await verifierBonjour(bonjour, defiAleatoire())).toBeNull();
  });

  test('un identifiant modifié après signature est refusé', async () => {
    const a = await locale('aaaaaaaaaaaa', 'tour');
    const defiB = defiAleatoire();
    const bonjour = await composerBonjour(a, defiB, defiAleatoire());
    expect(await verifierBonjour({ ...bonjour, de: 'cccccccccccc' }, defiB)).toBeNull();
  });

  test('un accueil sans la bonne clé est refusé ; un défi faux aussi', async () => {
    const a = await locale('aaaaaaaaaaaa', 'tour');
    const b = await locale('bbbbbbbbbbbb', 'portable');
    const defiA = defiAleatoire();
    const accueil = await composerAccueil(b, defiA);
    const autre = await composerAccueil(a, defiA);
    expect(await verifierAccueil({ ...accueil, identite: autre.identite }, defiA)).toBeNull();
    expect(await verifierAccueil(accueil, defiAleatoire())).toBeNull();
  });

  test('l’identifiant dérivé fait 12 caractères hexadécimaux et ne change pas', async () => {
    const identite = await genererIdentite();
    const un = await identifiantDerive(identite.publique);
    expect(un).toMatch(/^[a-f0-9]{12}$/);
    expect(await identifiantDerive(identite.publique)).toBe(un);
  });
});
