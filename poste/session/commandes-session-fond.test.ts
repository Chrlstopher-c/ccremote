// Responsabilité : tests de la commande « mettre en fond » exécutée sur une session du poste (SDK ou hors SDK).
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { type ContexteCommandes, executerSurSession } from './commandes-session.ts';
import { attendre, nouvelleSession } from './faux-sdk.ts';
import type { SessionPoste } from './session-poste.ts';

const ctx = {
  gestion: {},
  stockage: {},
  journal: pino({ enabled: false }),
  refusDistant: () => null,
  configDirs: () => [],
} as unknown as ContexteCommandes;

describe('commande mettre en fond sur une session du poste', () => {
  test('hors SDK (tmux, Desktop) : refus lisible, rien n’est envoyé', async () => {
    const reponse = await executerSurSession(ctx, {} as SessionPoste, {
      kind: 'mettre_en_fond',
      id: 's1',
      sessionId: 's1',
      appel: 'toolu_1',
    });
    expect(reponse).toEqual({ ok: false, erreur: 'non pris en charge pour cette session' });
  });

  test('SDK : la commande est passée en fond, la réponse dit enFond', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => requetes.length === 1);
    const reponse = await executerSurSession(ctx, session, {
      kind: 'mettre_en_fond',
      id: session.resume.id,
      sessionId: session.resume.id,
      appel: 'toolu_2',
    });
    expect(reponse).toEqual({ ok: true, donnees: { ok: true, enFond: true } });
    expect(requetes[0]?.fonds).toEqual(['toolu_2']);
  });
});
