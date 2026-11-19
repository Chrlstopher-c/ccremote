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
