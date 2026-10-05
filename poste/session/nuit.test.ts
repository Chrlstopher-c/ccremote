import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DELAI_REVEIL_MS,
  deciderVeille,
  finReussie,
  lireNuit,
  REVEILS_SANS_EFFET_MAX,
  type EtatVeille,
} from './nuit.ts';

const nuit = { depuisH: 1, casesOuvertes: 2, relances: 0, reveils: 0 };
const base: EtatVeille = {
  nuit,
  statut: 'attente',
  peutEcrire: true,
  attenteDepuisMs: 0,
  dernierReveilMs: null,
  reveilsSansEffet: 0,
  messagesChrisEnVol: 0,
  maintenantMs: DELAI_REVEIL_MS + 1,
};

describe('deciderVeille', () => {
  test('réveille une session à l’arrêt après le délai', () => {
    expect(deciderVeille(base).action).toBe('reveiller');
  });
  test('ne fait rien avant le délai, au travail, sans mode nuit ou sans tmux', () => {
    expect(deciderVeille({ ...base, maintenantMs: DELAI_REVEIL_MS - 1 }).action).toBe('rien');
    expect(deciderVeille({ ...base, statut: 'travail' }).action).toBe('rien');
    expect(deciderVeille({ ...base, nuit: null }).action).toBe('rien');
    expect(deciderVeille({ ...base, peutEcrire: false }).action).toBe('rien');
    expect(deciderVeille({ ...base, messagesChrisEnVol: 1 }).action).toBe('rien');
  });
  test('attend un délai plein entre deux réveils', () => {
    expect(deciderVeille({ ...base, dernierReveilMs: base.maintenantMs - 1000 }).action).toBe('rien');
  });
  test('abandonne après trop de réveils sans effet', () => {
    expect(deciderVeille({ ...base, reveilsSansEffet: REVEILS_SANS_EFFET_MAX }).action).toBe('abandonner');
  });
});

describe('lireNuit', () => {
  test('lit l’état écrit par les crochets, ignore l’absent et le périmé', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'nuit-'));
    mkdirSync(join(dossier, 'sessions'));
    process.env['QUART_NUIT_DIR'] = dossier;
    const maintenant = Date.now();
    writeFileSync(
      join(dossier, 'sessions', 'abc.json'),
      JSON.stringify({ since: maintenant / 1000 - 7200, rounds: 3, open: 4 }),
    );
    writeFileSync(
      join(dossier, 'sessions', 'vieux.json'),
      JSON.stringify({ since: maintenant / 1000 - 90000, rounds: 0 }),
    );
    expect(lireNuit('abc', maintenant, 1)).toEqual({ depuisH: 2, casesOuvertes: 4, relances: 3, reveils: 1 });
    expect(lireNuit('vieux', maintenant, 0)).toBeNull();
    expect(lireNuit('absent', maintenant, 0)).toBeNull();
    expect(lireNuit(null, maintenant, 0)).toBeNull();
  });
});

describe('finReussie', () => {
  test('lit la trace de `night done` une seule fois, ignore l’ancienne', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'nuit-'));
    mkdirSync(join(dossier, 'sessions'));
    process.env['QUART_NUIT_DIR'] = dossier;
    const maintenant = Date.now();
    writeFileSync(join(dossier, 'sessions', 'ok.done'), JSON.stringify({ at: maintenant / 1000 - 5 }));
    writeFileSync(join(dossier, 'sessions', 'vieux.done'), JSON.stringify({ at: maintenant / 1000 - 7200 }));
    expect(finReussie('ok', maintenant)).toBe(true);
    expect(finReussie('ok', maintenant)).toBe(false);
    expect(finReussie('vieux', maintenant)).toBe(false);
    expect(finReussie(null, maintenant)).toBe(false);
  });
});
