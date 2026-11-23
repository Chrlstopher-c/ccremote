// Responsabilité : une session SDK dont plusieurs messages ont été traités en un seul tour (Claude Code les réunit)
// ne reste pas « travail » : sans tour qui suit, elle passe au repos (23/11 : 18 min bloquée « travail »).
import { describe, expect, test } from 'bun:test';
import { attendre, nouvelleSession } from './faux-sdk.ts';

describe('SessionSdk — messages traités ensemble', () => {
  test('deux envois, un seul tour : la session repasse en attente', async () => {
    let liberer: () => void = () => undefined;
    const premier = new Promise<void>((resoudre) => {
      liberer = resoudre;
    });
    const { session } = nouvelleSession(
      async (texte) => {
        if (texte === 'un') {
          await premier;
          return [{ type: 'result' }];
        }
        return []; // « deux » a été lu avec « un » : aucun tour à lui
      },
      { delaiTourSuivantMs: 50 },
    );
    await session.lancer('un');
    expect(await session.envoyer('deux')).toBeNull();
    liberer();
    await attendre(() => session.resume.statut === 'attente');
    expect(session.resume.statut).toBe('attente');
  });

  test('un tour qui suit vraiment n’est pas coupé par la surveillance', async () => {
    const { session } = nouvelleSession(
      async (texte) => {
        if (texte === 'deux') await new Promise<void>((r) => setTimeout(r, 20));
        return [{ type: 'result' }];
      },
      { delaiTourSuivantMs: 500 },
    );
    await session.lancer('un');
    expect(await session.envoyer('deux')).toBeNull();
    await attendre(() => session.resume.statut === 'attente');
  });
});
