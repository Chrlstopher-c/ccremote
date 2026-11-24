// Responsabilité : tests de l'environnement donné aux sessions pilotées — la CLI en tête du PATH, le client nommé.
import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { CHEMIN_CLIENT_NAV, DOSSIER_NAV, environnementNav, VAR_CLIENT_NAV } from './environnement.ts';

describe('environnement des sessions pilotées', () => {
  test('le dossier de la CLI passe en tête du PATH du poste', () => {
    const env = environnementNav('/usr/bin:/bin');
    expect(env['PATH']).toBe(`${DOSSIER_NAV}:/usr/bin:/bin`);
    expect(environnementNav(undefined)['PATH']).toBe(DOSSIER_NAV);
  });

  test('le chemin du client est donné sous le nom attendu par les scripts', () => {
    expect(environnementNav(undefined)[VAR_CLIENT_NAV]).toBe(CHEMIN_CLIENT_NAV);
    expect(CHEMIN_CLIENT_NAV).toBe(join(DOSSIER_NAV, 'client.mjs'));
  });

  test('la CLI noctis-nav est exécutable dans son dossier', () => {
    expect(statSync(join(DOSSIER_NAV, 'noctis-nav')).mode & 0o111).not.toBe(0);
  });
});
