// Injecteur de la panne #27 — le tunnel perd des octets sous charge.
// Aucun socket, aucun processus : la perte est programmée, donc reproductible.

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../deterministe/horloge-simulee.ts';
import { JournalPannes } from '../journal/journal-pannes.ts';
import { ErreurIntegriteTuyau } from '../contrats/transport.ts';
import { TuyauOctets } from './tuyau-octets.ts';
import { rejouerDeuxFois } from '../rejeu.ts';

const octets = (n: number): Uint8Array => new Uint8Array(n).fill(1);

const monter = (
  mode: 'strict' | 'perte_silencieuse',
): { tuyau: TuyauOctets; journal: JournalPannes; recus: Uint8Array[] } => {
  const journal = new JournalPannes(new HorlogeSimulee());
  const tuyau = new TuyauOctets({ nom: 'pi->pc', mode }, journal);
  const recus: Uint8Array[] = [];
  tuyau.surOctets((paquet) => recus.push(paquet));
  return { tuyau, journal, recus };
};

describe('TuyauOctets — régime sain', () => {
  test('remet les octets aux abonnés et tient les compteurs', () => {
    const { tuyau, recus } = monter('strict');
    tuyau.ecrire(octets(10));
    tuyau.ecrire(octets(5));
    expect(recus.map((p) => p.length)).toEqual([10, 5]);
    expect(tuyau.octetsEmis()).toBe(15);
    expect(tuyau.octetsRecus()).toBe(15);
  });

  test('suspendre retient sans perdre ni remettre', () => {
    const { tuyau, recus } = monter('strict');
    tuyau.suspendre();
    tuyau.ecrire(octets(8));
    tuyau.ecrire(octets(4));
    expect(recus).toHaveLength(0);
    expect(tuyau.octetsRetenus()).toBe(12);
    expect(tuyau.octetsRecus()).toBe(0);
  });

  test('reprendre rejoue les octets retenus dans l’ordre', () => {
    const { tuyau, recus } = monter('strict');
    tuyau.suspendre();
    tuyau.ecrire(octets(3));
    tuyau.ecrire(octets(7));
    tuyau.reprendre();
    expect(recus.map((p) => p.length)).toEqual([3, 7]);
    expect(tuyau.octetsRetenus()).toBe(0);
    expect(tuyau.octetsRecus()).toBe(tuyau.octetsEmis());
  });
});

describe('TuyauOctets — injection de la panne #27 (perte d’octets)', () => {
  test('mode perte_silencieuse : la trame est tronquée sans erreur', () => {
    const { tuyau, journal, recus } = monter('perte_silencieuse');
    tuyau.injecterPerte(4);
    tuyau.ecrire(octets(10));
    expect(recus[0]?.length).toBe(6);
    expect(tuyau.octetsEmis()).toBe(10);
    expect(tuyau.octetsRecus()).toBe(6);
    expect(journal.filtrer('octets_perdus')[0]?.details).toEqual({ tuyau: 'pi->pc', perdus: 4 });
  });

  test('mode perte_silencieuse : la perte s’épuise, le flux redevient intègre', () => {
    const { tuyau } = monter('perte_silencieuse');
    tuyau.injecterPerte(3);
    tuyau.ecrire(octets(5));
    tuyau.ecrire(octets(5));
    expect(tuyau.octetsRecus()).toBe(7);
    expect(tuyau.octetsEmis() - tuyau.octetsRecus()).toBe(3);
  });

  test('mode strict : la perte échoue bruyamment (D.1.3)', () => {
    const { tuyau, journal } = monter('strict');
    tuyau.injecterPerte(2);
    expect(() => tuyau.ecrire(octets(6))).toThrow(ErreurIntegriteTuyau);
    expect(journal.contient('integrite_rompue')).toBe(true);
  });

  test('une perte de zéro octet n’altère rien', () => {
    const { tuyau, journal, recus } = monter('strict');
    tuyau.injecterPerte(0);
    tuyau.ecrire(octets(9));
    expect(recus[0]?.length).toBe(9);
    expect(journal.contient('octets_perdus')).toBe(false);
  });

  test('l’injection est reproductible à l’identique', async () => {
    const { premiere, seconde } = await rejouerDeuxFois(() => {
      const { tuyau, journal } = monter('perte_silencieuse');
      tuyau.injecterPerte(5);
      tuyau.suspendre();
      tuyau.ecrire(octets(4));
      tuyau.ecrire(octets(8));
      tuyau.reprendre();
      return journal.faits();
    });
    expect(premiere).toBe(seconde);
    expect(premiere).toContain('octets_perdus');
  });
});
