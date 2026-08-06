/**
 * Tests de `construireMagicPacket` — seule partie de `reveil-wol.ts` testable
 * sans réseau (voir l'en-tête du fichier source). `reveillerPc()` elle-même ne
 * peut être validée qu'en observant un PC réellement s'allumer : hors périmètre
 * d'un test unitaire, laissé à la validation opérationnelle.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { construireMagicPacket, resoudreMacPc } from './reveil-wol.ts';

describe('construireMagicPacket (Wake-on-LAN)', () => {
  test('102 octets : 6 × 0xFF puis 16 répétitions des 6 octets de la MAC', () => {
    const paquet = construireMagicPacket('aa:bb:cc:dd:ee:ff');
    expect(paquet.length).toBe(102);
    // Les 6 premiers octets sont le préambule 0xFF.
    for (let i = 0; i < 6; i += 1) expect(paquet[i]).toBe(0xff);
    // Puis 16 répétitions exactes des 6 octets de la MAC.
    const macAttendue = [0xb4, 0x2e, 0x99, 0x98, 0xaa, 0xf8];
    for (let rep = 0; rep < 16; rep += 1) {
      for (let octet = 0; octet < 6; octet += 1) {
        expect(paquet[6 + rep * 6 + octet]).toBe(macAttendue[octet] as number);
      }
    }
  });

  test('accepte aussi bien « : » que « - » comme séparateur', () => {
    const avecDeuxPoints = construireMagicPacket('aa:bb:cc:dd:ee:ff');
    const avecTirets = construireMagicPacket('b4-2e-99-98-aa-f8');
    expect(avecTirets.equals(avecDeuxPoints)).toBe(true);
  });

  test('rejette une MAC malformée plutôt que de construire un paquet invalide', () => {
    expect(() => construireMagicPacket('pas-une-mac')).toThrow();
    expect(() => construireMagicPacket('aa:bb:cc:dd:ee')).toThrow(); // 5 octets seulement
    expect(() => construireMagicPacket('')).toThrow();
  });

  // ☠ Validation dans les deux sens (règle de session) : un paquet BIEN formé
  // ne doit PAS échouer sur une garde trop stricte — sinon le test précédent ne
  // prouve rien, il se contente de rejeter par excès de prudence.
  test('n’échoue pas sur une MAC valide en majuscules', () => {
    expect(() => construireMagicPacket('AA:BB:CC:DD:EE:FF')).not.toThrow();
  });
});

describe('resoudreMacPc (surcharge CCREMOTE_PC_MAC)', () => {
  afterEach(() => {
    delete process.env['CCREMOTE_PC_MAC'];
  });

  test('retourne la valeur par défaut si la variable est absente', () => {
    delete process.env['CCREMOTE_PC_MAC'];
    expect(resoudreMacPc()).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('retourne la valeur par défaut si la variable est vide', () => {
    process.env['CCREMOTE_PC_MAC'] = '   ';
    expect(resoudreMacPc()).toBe('aa:bb:cc:dd:ee:ff');
  });

  test('retourne la MAC surchargée quand elle est bien formée', () => {
    process.env['CCREMOTE_PC_MAC'] = 'aa:bb:cc:dd:ee:ff';
    expect(resoudreMacPc()).toBe('aa:bb:cc:dd:ee:ff');
  });

  // ☠ Validation dans les deux sens : la garde ne doit pas rejeter une MAC
  // valide surchargée (sinon le test suivant ne prouve rien par lui-même).
  test('n’échoue pas sur une surcharge valide avec tirets', () => {
    process.env['CCREMOTE_PC_MAC'] = 'aa-bb-cc-dd-ee-ff';
    expect(() => resoudreMacPc()).not.toThrow();
  });

  test('refuse une surcharge malformée plutôt que de retomber silencieusement sur le défaut', () => {
    process.env['CCREMOTE_PC_MAC'] = 'pas-une-mac';
    expect(() => resoudreMacPc()).toThrow();
  });
});
