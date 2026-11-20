import { describe, expect, test } from 'bun:test';
import { attendre, nouvelleSession } from './faux-sdk.ts';

describe('SessionSdk — nom affiché du modèle, tel que le SDK le donne', () => {
  test('le nom du modèle courant vient de la liste du SDK (displayName), dans la fiche', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }], {
      resume: { modele: 'claude-mythos-5-2' },
    });
    await session.lancer('un');
    await attendre(() => session.resume.modeleNom === 'Mythos 5.2');
    expect(session.resume.modeleNom).toBe('Mythos 5.2');
  });

  test('un modèle absent de la liste du SDK : pas de nom, la fiche le garde vide', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }], {
      resume: { modele: 'claude-inconnu-1-0' },
    });
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente');
    await new Promise((r) => setTimeout(r, 20));
    expect(session.resume.modeleNom ?? null).toBeNull();
  });
});

describe('SessionSdk — modèle par défaut du compte', () => {
  test('défaut : le libellé anglais « Default (recommended) » n est jamais la fiche, c est le modèle résolu', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }], {
      resume: { modele: 'défaut' },
      modeles: [
        { value: 'default', resolvedModel: 'claude-haiku-5-5', displayName: 'Default (recommended)' },
        { value: 'claude-haiku-5-5', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5' },
      ],
    });
    await session.lancer('un');
    await attendre(() => session.resume.modeleNom === 'Haiku 5.5');
    expect(session.resume.modeleNom).toBe('Haiku 5.5');
  });

  test('modèle choisi Haiku 5.5 : l entrée « default » (résolue vers le même modèle) ne donne pas son libellé anglais', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }], {
      resume: { modele: 'claude-haiku-5-5' },
      modeles: [
        { value: 'default', resolvedModel: 'claude-haiku-5-5', displayName: 'Default (recommended)' },
        { value: 'claude-haiku-5-5', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5' },
      ],
    });
    await session.lancer('un');
    await attendre(() => session.resume.modeleNom === 'Haiku 5.5');
    expect(session.resume.modeleNom).toBe('Haiku 5.5');
  });

  test('défaut : le modèle réel du dernier message assistant remplace le nom', async () => {
    const { session } = nouvelleSession(
      async () => [{ type: 'assistant', message: { model: 'claude-mythos-5-2', content: [] } }, { type: 'result' }],
      { resume: { modele: 'défaut' }, modeles: [] },
    );
    await session.lancer('un');
    await attendre(() => session.resume.modeleNom === 'Mythos 5.2');
    expect(session.resume.modeleNom).toBe('Mythos 5.2');
  });
});
