// Responsabilité : tests de l'identité d'un membre — génération, export/import public et privé, empreinte.
import { describe, expect, test } from 'bun:test';
import { secretDh } from './cles.ts';
import {
  empreinteIdentite,
  exporterIdentitePrivee,
  exporterIdentitePublique,
  genererIdentite,
  importerIdentitePrivee,
  importerIdentitePublique,
} from './identite.ts';

describe('identité publique', () => {
  test('export base64url de 64 octets (86 caractères), aller-retour exact', async () => {
    const id = await genererIdentite();
    const texte = exporterIdentitePublique(id.publique);
    expect(texte).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(texte.length).toBe(86);
    const relue = await importerIdentitePublique(texte);
    expect(exporterIdentitePublique(relue)).toBe(texte);
  });

  test('texte mal formé ou trop court refusé', async () => {
    await expect(importerIdentitePublique('pas du base64 !')).rejects.toThrow();
    await expect(importerIdentitePublique('AAAA')).rejects.toThrow();
  });

  test('clé Ed25519 non canonique refusée (y ≥ p)', async () => {
    const id = await genererIdentite();
    const octets = new Uint8Array(64);
    octets.set(id.publique.dh, 0);
    octets.fill(0xff, 32);
    await expect(importerIdentitePublique(Buffer.from(octets).toString('base64url'))).rejects.toThrow();
  });
});

describe('empreinte', () => {
  test('16 groupes de 4 caractères hexadécimaux majuscules', async () => {
    const id = await genererIdentite();
    const empreinte = await empreinteIdentite(id.publique);
    expect(empreinte).toMatch(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/);
  });

  test('stable pour une même identité, différente entre deux identités', async () => {
    const a = await genererIdentite();
    const b = await genererIdentite();
    expect(await empreinteIdentite(a.publique)).toBe(await empreinteIdentite(a.publique));
    expect(await empreinteIdentite(a.publique)).not.toBe(await empreinteIdentite(b.publique));
  });
});

describe('identité privée', () => {
  test('export/import conserve la clé publique et les capacités (signature, échange)', async () => {
    const id = await genererIdentite();
    const pair = await genererIdentite();
    const texte = await exporterIdentitePrivee(id);
    const relue = await importerIdentitePrivee(texte);
    expect(exporterIdentitePublique(relue.publique)).toBe(exporterIdentitePublique(id.publique));
    const secretA = await secretDh(relue.dhPrivee, pair.publique.dh);
    const secretB = await secretDh(pair.dhPrivee, id.publique.dh);
    expect(Buffer.from(secretA).toString('hex')).toBe(Buffer.from(secretB).toString('hex'));
    const sig = await crypto.subtle.sign('Ed25519', relue.signaturePrivee, new Uint8Array([7, 7]));
    const verif = await crypto.subtle.importKey('raw', id.publique.signature, { name: 'Ed25519' }, false, ['verify']);
    expect(await crypto.subtle.verify('Ed25519', verif, sig, new Uint8Array([7, 7]))).toBe(true);
  });

  test('JSON invalide ou de mauvaise forme refusé', async () => {
    await expect(importerIdentitePrivee('{"version":2}')).rejects.toThrow();
    await expect(importerIdentitePrivee('pas du json')).rejects.toThrow();
  });
});
