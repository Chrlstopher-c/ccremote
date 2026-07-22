// Injecteur de la panne #29 — la contre-pression d'un client lent remonte
// jusqu'au worker. Régime sain : bourrage borné, abandon des plus anciens,
// producteur jamais bloqué (E.2.3), reprise au high-water mark (D.2.2).

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../deterministe/horloge-simulee.ts';
import { JournalPannes } from '../journal/journal-pannes.ts';
import type { EvenementObservation } from '../contrats/diffusion.ts';
import { DiffusionFactice, OPTIONS_DIFFUSION_SAINES } from './diffusion-factice.ts';
import { rejouerDeuxFois } from '../rejeu.ts';

interface Montage {
  readonly journal: JournalPannes;
  readonly diffusion: DiffusionFactice;
}

const monter = (contrePression = false): Montage => {
  const journal = new JournalPannes(new HorlogeSimulee());
  const diffusion = new DiffusionFactice(journal, {
    ...OPTIONS_DIFFUSION_SAINES,
    contrePressionJusquAuWorker: contrePression,
  });
  return { journal, diffusion };
};

const evenement = (sequence: number): EvenementObservation => ({
  sequence,
  idEquipe: 'eq-1',
  charge: { n: sequence },
});

const publierJusqua = (m: Montage, dernier: number, depuis = 1): void => {
  for (let s = depuis; s <= dernier; s += 1) m.diffusion.publier(evenement(s));
};

describe('DiffusionFactice — régime sain (#29 absente)', () => {
  test('un client lent ne bloque jamais le producteur', () => {
    const m = monter(false);
    m.diffusion.abonner('c1', 2, 0);
    publierJusqua(m, 10);
    expect(m.diffusion.blocagesProducteur()).toBe(0);
    expect(m.journal.contient('producteur_bloque')).toBe(false);
  });

  test('le tampon est borné et abandonne les plus anciens', () => {
    const m = monter(false);
    m.diffusion.abonner('c1', 2, 0);
    publierJusqua(m, 5);
    expect(m.diffusion.tampon('c1').map((e) => e.sequence)).toEqual([4, 5]);
    expect(m.diffusion.abandonnes('c1')).toBe(3);
    expect(m.journal.compter('evenement_abandonne')).toBe(3);
  });

  test('un client rapide ne perd rien', () => {
    const m = monter(false);
    m.diffusion.abonner('c1', 10, 0);
    publierJusqua(m, 6);
    expect(m.diffusion.consommer('c1', 10).map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.diffusion.abandonnes('c1')).toBe(0);
  });

  test('un client lent n’affecte pas un client rapide (isolation)', () => {
    const m = monter(false);
    m.diffusion.abonner('lent', 1, 0);
    m.diffusion.abonner('rapide', 100, 0);
    publierJusqua(m, 20);
    expect(m.diffusion.abandonnes('rapide')).toBe(0);
    expect(m.diffusion.abandonnes('lent')).toBe(19);
    expect(m.diffusion.blocagesProducteur()).toBe(0);
  });
});

describe('DiffusionFactice — reprise au high-water mark (D.2.2)', () => {
  test('consommer fait avancer le high-water mark', () => {
    const m = monter(false);
    m.diffusion.abonner('c1', 10, 0);
    publierJusqua(m, 4);
    m.diffusion.consommer('c1', 3);
    expect(m.diffusion.hautNiveau('c1')).toBe(3);
  });

  test('un rattachement à une séquence donnée ne rejoue pas l’historique', () => {
    const m = monter(false);
    m.diffusion.abonner('c1', 10, 5);
    publierJusqua(m, 8);
    expect(m.diffusion.tampon('c1').map((e) => e.sequence)).toEqual([6, 7, 8]);
  });

  test('un client inconnu ne fait rien planter', () => {
    const m = monter(false);
    expect(m.diffusion.consommer('fantome', 5)).toEqual([]);
    expect(m.diffusion.hautNiveau('fantome')).toBe(0);
    expect(m.diffusion.abandonnes('fantome')).toBe(0);
  });
});

describe('DiffusionFactice — injection de la panne #29', () => {
  test('contre-pression activée : le producteur est bloqué et les faits le disent', () => {
    const m = monter(true);
    m.diffusion.abonner('c1', 2, 0);
    publierJusqua(m, 5);
    expect(m.diffusion.blocagesProducteur()).toBe(3);
    expect(m.journal.compter('producteur_bloque')).toBe(3);
    expect(m.diffusion.abandonnes('c1')).toBe(0);
    expect(m.diffusion.tampon('c1').map((e) => e.sequence)).toEqual([1, 2]);
  });

  test('configurer bascule le mode en cours de scénario', () => {
    const m = monter(false);
    m.diffusion.abonner('c1', 1, 0);
    publierJusqua(m, 2);
    m.diffusion.configurer({ contrePressionJusquAuWorker: true });
    publierJusqua(m, 4, 3);
    expect(m.diffusion.abandonnes('c1')).toBe(1);
    expect(m.diffusion.blocagesProducteur()).toBe(2);
  });

  test('l’injection est reproductible à l’identique', async () => {
    const { premiere, seconde } = await rejouerDeuxFois(() => {
      const m = monter(true);
      m.diffusion.abonner('c1', 2, 0);
      m.diffusion.abonner('c2', 4, 0);
      publierJusqua(m, 7);
      m.diffusion.consommer('c1', 1);
      publierJusqua(m, 9, 8);
      return m.journal.faits();
    });
    expect(premiere).toBe(seconde);
    expect(premiere).toContain('producteur_bloque');
  });
});
