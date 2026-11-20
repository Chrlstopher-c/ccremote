// Responsabilité : tests de l'activité d'une session SDK tenue par un processus hors Lanterne (terminal, Desktop) —
// statut et drapeau `terminal` posés par rattacherTerminal, requête Lanterne vivante préservée — et du mode de
// permission annoncé par le message `system/init` (modeDeInit).
import { describe, expect, test } from 'bun:test';
import { nouvelleSession } from './faux-sdk.ts';
import { modeDeInit } from './modes-sdk.ts';

describe('SessionSdk.rattacherTerminal', () => {
  test('une session non vivante tenue par un terminal passe au travail, sans changer son activité', () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }]);
    const majAvant = session.resume.majLe;
    session.rattacherTerminal(true, true);
    expect(session.resume.statut).toBe('travail');
    expect(session.resume.terminal).toBe(true);
    expect(session.resume.majLe).toBe(majAvant);
  });

  test('le terminal qui se ferme remet la session en fermée', () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }]);
    session.rattacherTerminal(true, true);
    session.rattacherTerminal(false);
    expect(session.resume.statut).toBe('fermee');
    expect(session.resume.terminal).toBe(false);
  });

  test('une requête Lanterne vivante l’emporte : le rattachement au terminal ne change rien', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    expect(session.vivante).toBe(true);
    const avant = session.resume;
    session.rattacherTerminal(true, true);
    expect(session.resume).toEqual(avant);
  });
});

describe('modeDeInit', () => {
  test('le message system/init annonce le mode de permission réel de la session', () => {
    expect(modeDeInit({ type: 'system', subtype: 'init', permissionMode: 'auto' })).toBe('auto');
  });

  test('un mode inconnu, un autre sous-type ou un autre message ne disent rien', () => {
    expect(modeDeInit({ type: 'system', subtype: 'init', permissionMode: 'yolo' })).toBeNull();
    expect(modeDeInit({ type: 'system', subtype: 'autre', permissionMode: 'auto' })).toBeNull();
    expect(modeDeInit({ type: 'assistant', permissionMode: 'auto' })).toBeNull();
    expect(modeDeInit(null)).toBeNull();
  });
});
