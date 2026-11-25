// Responsabilité : tests purs du mode rapide et d'Ultracode d'une session SDK — lecture de l'état rapporté par le
// SDK, masquage de `sdk_opt_in_required`, compatibilité du modèle, bascules, réglages appliqués relus.
import { describe, expect, test } from 'bun:test';
import {
  compatibleRapide,
  etatRapideLu,
  lireReglagesAppliques,
  rapideBascule,
  rapideDefaut,
  rapideLu,
  raisonRapide,
  ultracodeBascule,
  ultracodeDefaut,
  ultracodeLu,
} from './modes-sdk.ts';

describe('état du mode rapide rapporté par le SDK', () => {
  test('lit fast_mode_state et fast_mode_disabled_reason d un message result', () => {
    const msg = { type: 'result', fast_mode_state: 'off', fast_mode_disabled_reason: 'extra_usage_disabled' };
    expect(etatRapideLu(msg)).toEqual({ etat: 'off', raison: 'extra_usage_disabled' });
  });

  test('sans raison, la raison est null (rien ne bloque)', () => {
    const init = { type: 'system', subtype: 'init', fast_mode_state: 'on' };
    expect(etatRapideLu(init)).toEqual({ etat: 'on', raison: null });
  });

  test('un message sans fast_mode_state, ou une valeur inconnue, ne dit rien', () => {
    expect(etatRapideLu({ type: 'assistant' })).toBeNull();
    expect(etatRapideLu({ type: 'result', fast_mode_state: 'peut-etre' })).toBeNull();
    expect(etatRapideLu(null)).toBeNull();
    expect(etatRapideLu('texte')).toBeNull();
  });

  test('cooldown est une valeur valide', () => {
    expect(etatRapideLu({ fast_mode_state: 'cooldown' })).toEqual({ etat: 'cooldown', raison: null });
  });
});

describe('raison exposée', () => {
  test('sdk_opt_in_required n est jamais exposé quand le mode rapide n est pas demandé', () => {
    expect(raisonRapide(false, 'sdk_opt_in_required')).toBeNull();
  });

  test('sdk_opt_in_required est exposé quand le mode rapide est demandé', () => {
    expect(raisonRapide(true, 'sdk_opt_in_required')).toBe('sdk_opt_in_required');
  });

  test('les autres raisons restent exposées, demandé ou non', () => {
    expect(raisonRapide(false, 'extra_usage_disabled')).toBe('extra_usage_disabled');
    expect(raisonRapide(true, 'extra_usage_disabled')).toBe('extra_usage_disabled');
    expect(raisonRapide(true, null)).toBeNull();
  });
});

describe('état rapide après lecture', () => {
  test('une session sans état antérieur part de la valeur par défaut', () => {
    expect(rapideDefaut()).toEqual({ demande: false, etat: null, raison: null, compatible: null });
  });

  test('une lecture met etat et raison à jour, sans toucher à la demande ni à la compatibilité', () => {
    const avant = { demande: true, etat: null, raison: null, compatible: true };
    expect(rapideLu(avant, { etat: 'cooldown', raison: null })).toEqual({
      demande: true,
      etat: 'cooldown',
      raison: null,
      compatible: true,
    });
  });

  test('une lecture sans état (message sans champ) garde l état antérieur, compatibilité comprise', () => {
    const avant = { demande: false, etat: 'off' as const, raison: null, compatible: false };
    expect(rapideLu(avant, null)).toEqual(avant);
  });

  test('la compatibilité calculée au démarrage remplace l ancienne valeur', () => {
    expect(rapideLu(undefined, null, true)).toEqual({ demande: false, etat: null, raison: null, compatible: true });
  });
});

describe('bascule du mode rapide', () => {
  test('activer : demande vraie, état en attente du rapport du SDK', () => {
    const avant = { demande: false, etat: 'off' as const, raison: 'extra_usage_disabled', compatible: true };
    expect(rapideBascule(avant, true)).toEqual({
      demande: true,
      etat: null,
      raison: null,
      compatible: true,
    });
  });

  test('couper : demande fausse, état off, raison effacée', () => {
    expect(rapideBascule({ demande: true, etat: 'on', raison: null, compatible: null }, false)).toEqual({
      demande: false,
      etat: 'off',
      raison: null,
      compatible: null,
    });
  });
});

describe('compatibilité du modèle avec le mode rapide', () => {
  const modeles = [
    { value: 'default', displayName: 'Default', resolvedModel: 'claude-opus-5-5', supportsFastMode: true },
    { value: 'claude-opus-5-5', displayName: 'Opus 5.5', supportsFastMode: true },
    { value: 'claude-haiku-5-5', displayName: 'Haiku 5.5', supportsFastMode: false },
    { value: 'claude-sans-info', displayName: 'Sans info' },
  ];

  test('un modèle nommé par son identifiant : son drapeau du SDK', () => {
    expect(compatibleRapide('claude-haiku-5-5', modeles)).toBe(false);
    expect(compatibleRapide('claude-opus-5-5', modeles)).toBe(true);
  });

  test('le modèle par défaut : la fiche du SDK pour « default »', () => {
    expect(compatibleRapide('défaut', modeles)).toBe(true);
  });

  test('un modèle résolu comme identifiant est reconnu', () => {
    const resolu = [{ value: 'x', resolvedModel: 'claude-opus-5-5-20260101', displayName: 'X', supportsFastMode: true }];
    expect(compatibleRapide('claude-opus-5-5-20260101', resolu)).toBe(true);
  });

  test('inconnu de la liste, ou sans drapeau : null', () => {
    expect(compatibleRapide('claude-inconnu', modeles)).toBeNull();
    expect(compatibleRapide('claude-sans-info', modeles)).toBeNull();
    expect(compatibleRapide('claude-haiku-5-5', undefined)).toBeNull();
  });
});

describe('Ultracode', () => {
  test('une session sans Ultracode part de la valeur par défaut', () => {
    expect(ultracodeDefaut()).toEqual({ demande: false, actif: false, disponible: null });
  });

  test('après une bascule, les réglages appliqués du SDK font foi', () => {
    const applique = { applied: { ultracode: true, ultracodeRequested: true, ultracodeAvailable: true } };
    const lus = lireReglagesAppliques(applique);
    expect(ultracodeBascule(true, lus)).toEqual({ demande: true, actif: true, disponible: true });
  });

  test('getSettings en échec : demande = actif, disponibilité inconnue', () => {
    expect(ultracodeBascule(false, null)).toEqual({ demande: false, actif: false, disponible: null });
    expect(ultracodeBascule(true, null)).toEqual({ demande: true, actif: true, disponible: null });
  });

  test('une lecture de disponibilité sans bascule : la demande et l état restent', () => {
    expect(ultracodeLu({ demande: true, actif: true, disponible: null }, { ultracodeAvailable: false })).toEqual({
      demande: true,
      actif: true,
      disponible: false,
    });
  });

  test('à l ouverture avec settings.ultracode : le relevé du SDK rend Ultracode actif', () => {
    expect(
      ultracodeLu(
        { demande: true, actif: false, disponible: null },
        { ultracode: true, ultracodeRequested: true, ultracodeAvailable: true },
      ),
    ).toEqual({ demande: true, actif: true, disponible: true });
  });

  test('lireReglagesAppliques rend null sans champ applied utile', () => {
    expect(lireReglagesAppliques({})).toBeNull();
    expect(lireReglagesAppliques(null)).toBeNull();
    expect(lireReglagesAppliques({ applied: { ultracode: 'oui' } })).toEqual({});
  });
});

describe('version du harnais au démarrage', () => {
  test('lue dans system/init, ignorée ailleurs', async () => {
    const { versionDeInit } = await import('./modes-sdk.ts');
    expect(versionDeInit({ type: 'system', subtype: 'init', claude_code_version: '2.1.332' })).toBe('2.1.332');
    expect(versionDeInit({ type: 'assistant', claude_code_version: '2.1.332' })).toBeNull();
  });
});
