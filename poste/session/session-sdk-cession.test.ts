// Responsabilité : tests de la cession d'une session SDK à un processus Claude interactif hors Lanterne — le poste
// rend la main : fermeture immédiate sans tour en cours, fermeture à la fin du tour sinon, sans relance après.
import { describe, expect, test } from 'bun:test';
import { attendre, nouvelleSession } from './faux-sdk.ts';

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('SessionSdk — cession à un processus interactif hors Lanterne', () => {
  test('sans tour en cours, la requête se ferme tout de suite et la fiche passe terminal', async () => {
    const { session, requetes, evenements } = nouvelleSession(async () => [
      { type: 'texte', texte: 'ok' },
      { type: 'result' },
    ]);
    expect(await session.lancer('un')).toBeNull();
    await attendre(() => evenements.some((e) => e.type === 'tour_fini'));
    session.cederSiTenue(true);
    expect(requetes[0]?.fermee).toBe(true);
    expect(session.vivante).toBe(false);
    expect(session.resume.terminal).toBe(true);
    expect(session.persistee.aReprendre).toBe(false);
    expect(await session.reprendre('deux')).toMatch(/Claude Desktop ou un terminal/);
  });

  test('en plein tour, la requête reste ouverte jusqu’à la fin du tour, puis se ferme sans relance', async () => {
    let finirTour: () => void = () => undefined;
    const fin = new Promise<void>((r) => {
      finirTour = r;
    });
    const textes: string[] = [];
    const { session, requetes, evenements } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        await fin;
        return [{ type: 'result' }];
      },
      { objectif: 'livrer la cession' },
    );
    await session.lancer('un');
    await attendre(() => textes.length === 1);
    session.cederSiTenue(true);
    await pause(20);
    expect(requetes[0]?.fermee).toBe(false);
    expect(session.vivante).toBe(true);
    finirTour();
    await attendre(() => requetes[0]?.fermee === true);
    expect(session.vivante).toBe(false);
    expect(session.resume.terminal).toBe(true);
    await pause(20);
    expect(textes).toHaveLength(1);
    expect(evenements.some((e) => e.type === 'relance')).toBe(false);
  });

  test('témoin : sans cession, la même fin de tour autonome est relancée', async () => {
    const textes: string[] = [];
    const { session, requetes, evenements } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        return [{ type: 'result' }];
      },
      { resume: { autonomie: true }, objectif: 'livrer la cession' },
    );
    await session.lancer('un');
    await attendre(() => textes.length >= 2);
    expect(requetes[0]?.fermee).toBe(false);
    expect(evenements.some((e) => e.type === 'relance')).toBe(true);
  });

  test('une session déjà non vivante n’est pas touchée par une cession', () => {
    const { session, requetes } = nouvelleSession(async () => []);
    session.cederSiTenue(true);
    expect(requetes).toHaveLength(0);
    expect(session.resume.terminal).toBeUndefined();
  });
});
