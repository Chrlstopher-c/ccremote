// Responsabilité : tests mise en fond (Ctrl+B) d'une commande au premier plan d'une session SDK.
import { describe, expect, test } from 'bun:test';
import { attendre, nouvelleSession } from './faux-sdk.ts';

describe('mise en fond d une commande en cours (Ctrl+B)', () => {
  test('l appel part au SDK ; une commande prise en fond ne signale rien', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => requetes.length === 1);
    expect(await session.mettreEnFond('toolu_01abc')).toBeNull();
    expect(requetes[0]?.fonds).toEqual(['toolu_01abc']);
  });

  test('une commande qui n est plus en cours est refusée lisiblement', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => requetes.length === 1);
    if (requetes[0]) requetes[0].resultatFond = false;
    expect(await session.mettreEnFond('toolu_absent')).toBe('la commande n’est plus en cours');
  });

  test('un SDK qui lève (mises en fond désactivées) remonte son motif, sans planter', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => requetes.length === 1);
    if (requetes[0]) requetes[0].resultatFond = new Error('tâches de fond désactivées');
    const erreur = await session.mettreEnFond('toolu_1');
    expect(erreur).toContain('mise en fond impossible');
    expect(erreur).toContain('tâches de fond désactivées');
  });

  test('session sans requête vivante : session fermée', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }]);
    expect(await session.mettreEnFond('toolu_1')).toBe('session fermée');
  });
});
