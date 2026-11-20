// Responsabilité : tests d'une session SDK et de ses modes — mode rapide (fastMode) et Ultracode : réglages à
// l'ouverture, à la reprise, bascules dans la requête vivante, état rapporté par le SDK, effort sans coupure d'Ultracode.
import { describe, expect, test } from 'bun:test';
import { attendre, nouvelleSession, type RequeteFausse } from './faux-sdk.ts';

const TOUR = async () => [{ type: 'result' }];

describe('mode rapide à l ouverture et à la reprise', () => {
  test('demandé à l ouverture : fastMode part dans les réglages de query()', async () => {
    const { session, requetes } = nouvelleSession(TOUR, {
      resume: { rapide: { demande: true, etat: null, raison: null, compatible: null } },
    });
    await session.lancer('bonjour');
    expect(requetes[0]?.options.settings).toEqual({ fastMode: true });
  });

  test('non demandé : aucun réglage de mode dans query()', async () => {
    const { session, requetes } = nouvelleSession(TOUR);
    await session.lancer('bonjour');
    expect(requetes[0]?.options.settings).toBeUndefined();
  });

  test('reprise : le mode rapide et Ultracode demandés sont réappliqués', async () => {
    const { session, requetes } = nouvelleSession(TOUR, {
      reprise: { statut: 'fermee' },
      resume: {
        rapide: { demande: true, etat: 'on', raison: null, compatible: true },
        ultracode: { demande: true, actif: false, disponible: true },
      },
    });
    await session.reprendre();
    expect(requetes[0]?.options.resume).toBe('claude-abc');
    expect(requetes[0]?.options.settings).toEqual({ fastMode: true, ultracode: true });
  });
});

describe('bascule du mode rapide dans la requête vivante', () => {
  test('activer puis couper : applyFlagSettings reçoit fastMode, l état suit la demande', async () => {
    const { session, requetes } = nouvelleSession(TOUR);
    await session.lancer('x');
    const requete = requetes[0] as RequeteFausse;
    expect(await session.reglerSession({ kind: 'rapide', actif: true })).toBeNull();
    expect(requete.flagSettings).toEqual([{ fastMode: true }]);
    expect(session.resume.rapide).toMatchObject({ demande: true, etat: null, raison: null });
    expect(await session.reglerSession({ kind: 'rapide', actif: false })).toBeNull();
    expect(requete.flagSettings.at(-1)).toEqual({ fastMode: false });
    expect(session.resume.rapide).toMatchObject({ demande: false, etat: 'off', raison: null });
  });

  test('un refus du SDK : rien ne change dans la fiche, le motif est rendu', async () => {
    const { session } = nouvelleSession(TOUR, { refusReglages: true });
    await session.lancer('x');
    const erreur = await session.reglerSession({ kind: 'rapide', actif: true });
    expect(erreur).toStartWith('réglage impossible');
    expect(session.resume.rapide?.demande ?? false).toBe(false);
  });

  test('sans requête ouverte : la demande est gardée pour la prochaine ouverture', async () => {
    const { session, requetes } = nouvelleSession(TOUR);
    expect(await session.reglerSession({ kind: 'rapide', actif: true })).toBeNull();
    expect(requetes).toHaveLength(0);
    expect(session.resume.rapide).toMatchObject({ demande: true, etat: null });
  });
});

describe('état du mode rapide rapporté par le SDK', () => {
  test('un result sans demande : etat off, sdk_opt_in_required masqué', async () => {
    const { session } = nouvelleSession(async () => [
      { type: 'result', fast_mode_state: 'off', fast_mode_disabled_reason: 'sdk_opt_in_required' },
    ]);
    await session.lancer('x');
    await attendre(() => session.resume.statut === 'attente');
    expect(session.resume.rapide).toMatchObject({ demande: false, etat: 'off', raison: null });
  });

  test('un result avec demande : la raison réelle est exposée', async () => {
    const { session } = nouvelleSession(
      async () => [{ type: 'result', fast_mode_state: 'off', fast_mode_disabled_reason: 'sdk_opt_in_required' }],
      { resume: { rapide: { demande: true, etat: null, raison: null, compatible: null } } },
    );
    await session.lancer('x');
    await attendre(() => session.resume.statut === 'attente');
    expect(session.resume.rapide).toMatchObject({ demande: true, etat: 'off', raison: 'sdk_opt_in_required' });
  });

  test('l état d initialisation est lu à l ouverture', async () => {
    const { session } = nouvelleSession(TOUR, {
      initRapide: { fast_mode_state: 'cooldown', fast_mode_disabled_reason: 'network_error' },
    });
    await session.lancer('x');
    await attendre(() => session.resume.rapide?.etat === 'cooldown');
    expect(session.resume.rapide).toMatchObject({ etat: 'cooldown', raison: 'network_error' });
  });
});

describe('compatibilité du modèle avec le mode rapide', () => {
  const modeles = [
    { value: 'claude-haiku-5-5', displayName: 'Haiku 5.5', supportsFastMode: false },
    { value: 'claude-mythos-5-2', displayName: 'Mythos 5.2', supportsFastMode: true },
  ];

  test('calculée à l ouverture, puis recalculée après un changement de modèle', async () => {
    const { session } = nouvelleSession(TOUR, { modeles });
    await session.lancer('x');
    await attendre(() => session.resume.rapide?.compatible === false);
    expect(await session.reglerSession({ kind: 'modele', modele: 'claude-mythos-5-2' })).toBeNull();
    await attendre(() => session.resume.rapide?.compatible === true);
  });
});

describe('Ultracode', () => {
  test('bascule : applyFlagSettings reçoit ultracode, l état vient de getSettings', async () => {
    const { session, requetes } = nouvelleSession(TOUR);
    await session.lancer('x');
    expect(await session.reglerSession({ kind: 'ultracode', actif: true })).toBeNull();
    expect(requetes[0]?.flagSettings).toEqual([{ ultracode: true }]);
    expect(session.resume.ultracode).toEqual({ demande: true, actif: true, disponible: true });
  });

  test('getSettings en échec : la demande est gardée, la disponibilité est inconnue', async () => {
    const { session } = nouvelleSession(TOUR, { echecReglages: true });
    await session.lancer('x');
    expect(await session.reglerSession({ kind: 'ultracode', actif: true })).toBeNull();
    expect(session.resume.ultracode).toEqual({ demande: true, actif: true, disponible: null });
  });

  test('couper Ultracode : demande et état tombent à faux', async () => {
    const { session, requetes } = nouvelleSession(TOUR, {
      resume: { ultracode: { demande: true, actif: true, disponible: true } },
    });
    await session.lancer('x');
    await session.reglerSession({ kind: 'ultracode', actif: false });
    expect(requetes[0]?.flagSettings).toEqual([{ ultracode: false }]);
    expect(session.resume.ultracode).toEqual({ demande: false, actif: false, disponible: true });
  });

  test('ouverture : ultracode part dans les réglages de query()', async () => {
    const { session, requetes } = nouvelleSession(TOUR, {
      resume: { ultracode: { demande: true, actif: false, disponible: null } },
    });
    await session.lancer('x');
    expect(requetes[0]?.options.settings).toEqual({ ultracode: true });
  });
});

describe('effort et Ultracode : l effort ne coupe pas Ultracode', () => {
  test('Ultracode demandé : le réglage d effort envoie ultracode: true avec l effort', async () => {
    const { session, requetes } = nouvelleSession(TOUR, {
      resume: { ultracode: { demande: true, actif: true, disponible: true } },
    });
    await session.lancer('x');
    await session.reglerSession({ kind: 'effort', effort: 'high' });
    expect(requetes[0]?.flagSettings).toEqual([{ effortLevel: 'high', ultracode: true }]);
  });

  test('Ultracode non demandé : l effort part seul, sans clé ultracode', async () => {
    const { session, requetes } = nouvelleSession(TOUR);
    await session.lancer('x');
    await session.reglerSession({ kind: 'effort', effort: 'high' });
    expect(requetes[0]?.flagSettings).toEqual([{ effortLevel: 'high' }]);
    expect(requetes[0]?.flagSettings[0]).not.toHaveProperty('ultracode');
  });
});
