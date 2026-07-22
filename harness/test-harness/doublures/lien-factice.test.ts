// Injecteur des pannes #28 (transitoire remonté à l'orchestrateur) et de la
// taxonomie de fermeture D.2.1, dont le 4090 qui interdit tout rattachement.

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../deterministe/horloge-simulee.ts';
import { JournalPannes } from '../journal/journal-pannes.ts';
import type { CodeFermeture, FermetureTerminale } from '../contrats/transport.ts';
import { LienFactice } from './lien-factice.ts';
import { rejouerDeuxFois } from '../rejeu.ts';

interface Montage {
  readonly horloge: HorlogeSimulee;
  readonly journal: JournalPannes;
  readonly lien: LienFactice;
  readonly fermetures: FermetureTerminale[];
}

const monter = (): Montage => {
  const horloge = new HorlogeSimulee();
  const journal = new JournalPannes(horloge);
  const lien = new LienFactice(horloge, journal);
  const fermetures: FermetureTerminale[] = [];
  lien.surFermeture((f) => fermetures.push(f));
  return { horloge, journal, lien, fermetures };
};

describe('LienFactice — coupure transitoire absorbée (#28, régime sain)', () => {
  test('la coupure ne déclenche aucun onClose et retient les octets', () => {
    const { lien, fermetures } = monter();
    lien.couperTransitoire(3_000);
    lien.versPc().ecrire(new Uint8Array(12));
    expect(lien.etat()).toBe('coupe_transitoire');
    expect(fermetures).toHaveLength(0);
    expect(lien.versPc().octetsRecus()).toBe(0);
  });

  test('le lien se rétablit seul à l’échéance et rejoue les octets', () => {
    const { horloge, lien, journal } = monter();
    lien.couperTransitoire(3_000);
    lien.versPc().ecrire(new Uint8Array(12));
    horloge.avancer(2_999);
    expect(lien.etat()).toBe('coupe_transitoire');
    horloge.avancer(1);
    expect(lien.etat()).toBe('ouvert');
    expect(lien.versPc().octetsRecus()).toBe(12);
    expect(journal.sequenceRespectee(['lien_coupe_transitoire', 'lien_retabli'])).toBe(true);
  });

  test('aucune remontée transitoire n’est comptée en régime sain', () => {
    const { horloge, lien } = monter();
    lien.couperTransitoire(500);
    horloge.avancer(500);
    expect(lien.remonteesTransitoires()).toBe(0);
  });

  test('deux coupures imbriquées ne se superposent pas', () => {
    const { lien, journal } = monter();
    lien.couperTransitoire(1_000);
    lien.couperTransitoire(1_000);
    expect(journal.compter('lien_coupe_transitoire')).toBe(1);
  });
});

describe('LienFactice — injection du défaut #28', () => {
  test('remonterTransitoire matérialise le bruit vers l’orchestrateur', () => {
    const { lien, journal } = monter();
    lien.couperTransitoire(100);
    lien.remonterTransitoire();
    lien.remonterTransitoire();
    expect(lien.remonteesTransitoires()).toBe(2);
    expect(journal.compter('remontee_transitoire_orchestrateur')).toBe(2);
  });
});

describe('LienFactice — fermetures terminales (D.2.1)', () => {
  test('4090 interdit le rattachement : le worker doit se terminer', () => {
    const { lien, fermetures } = monter();
    const fermeture = lien.couperTerminal(4090);
    expect(fermeture.rattachementAutorise).toBe(false);
    expect(lien.etat()).toBe('ferme_terminal');
    expect(fermetures[0]?.code).toBe(4090);
  });

  test('les autres codes terminaux autorisent un rattachement', () => {
    const codes: readonly CodeFermeture[] = [401, 403, 404, 4091, 4092];
    for (const code of codes) {
      const { lien } = monter();
      expect(lien.couperTerminal(code).rattachementAutorise).toBe(true);
    }
  });

  test('chaque code porte une raison non vide', () => {
    const { lien } = monter();
    expect(lien.couperTerminal(401).raison.length).toBeGreaterThan(0);
  });
});

describe('LienFactice — rattachement', () => {
  test('rattacher rouvre le lien et compte le rattachement à froid', () => {
    const { lien } = monter();
    lien.couperTerminal(4092);
    lien.rattacher();
    expect(lien.etat()).toBe('ouvert');
    expect(lien.rattachements()).toBe(1);
  });

  test('le scénario coupure + rétablissement est reproductible', async () => {
    const { premiere, seconde } = await rejouerDeuxFois(() => {
      const { horloge, lien, journal } = monter();
      lien.couperTransitoire(2_000);
      lien.versPi().ecrire(new Uint8Array(6));
      horloge.avancer(2_000);
      lien.couperTerminal(4090);
      return journal.faits();
    });
    expect(premiere).toBe(seconde);
    expect(premiere).toContain('lien_ferme_terminal');
  });
});
