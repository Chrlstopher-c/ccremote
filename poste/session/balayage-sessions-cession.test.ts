// Responsabilité : tests du balayage qui transmet la cession aux sessions SDK, à partir de processus Claude
// construits à la main (aucune lecture de /proc) : un processus SDK (notre propre session) ne déclenche jamais
// de cession.
import { describe, expect, test } from 'bun:test';
import type { ConfigPoste } from '../config.ts';
import { BalayageSessions } from './balayage-sessions.ts';
import { journal, nouvelleSession } from './faux-sdk.ts';
import type { ProcessusClaude } from './processus.ts';
import type { SessionPoste } from './session-poste.ts';
import { ModelesChoisis } from './modeles-choisis.ts';
import { SessionsSupprimees } from './suppression.ts';

const CONFIG: ConfigPoste = {
  machine: 'poste-test',
  relais: 'relais-test',
  secret: 'secret-test',
  description: 'poste de test',
  racines: [],
  comptes: { principal: null },
  distants: [],
  donnees: 'donnees-test',
  fenetreContexte: 1_000_000,
};

const processus = (sessionId: string, sdk: boolean): ProcessusClaude => ({
  pid: 1,
  sessionId,
  cwd: '/projets/app',
  enTmux: false,
  configDir: null,
  nom: null,
  sdk,
});

function balayageAvec(session: SessionPoste): BalayageSessions {
  return new BalayageSessions({
    config: CONFIG,
    journal,
    sessions: new Map([[session.resume.id, session]]),
    supprimees: new SessionsSupprimees('donnees-test-inexistantes'),
    fichePour: () => undefined,
    creer: () => {
      throw new Error('creer non attendu dans ce test');
    },
    modeles: new ModelesChoisis('donnees-test-inexistantes/modeles-choisis.json', journal),
  });
}

describe('BalayageSessions.cederTenues', () => {
  test('un processus SDK (notre propre session) ne ferme rien', async () => {
    const { session, requetes } = nouvelleSession(async () => []);
    await session.lancer('un');
    balayageAvec(session).cederTenues([processus('claude-abc', true)]);
    expect(requetes[0]?.fermee).toBe(false);
    expect(session.vivante).toBe(true);
    expect(session.resume.terminal).toBeUndefined();
  });

  test('un processus interactif hors SDK sur la même conversation fait céder la session', async () => {
    const { session, requetes, evenements } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await new Promise((r) => setTimeout(r, 20));
    expect(evenements.some((e) => e.type === 'tour_fini')).toBe(true);
    balayageAvec(session).cederTenues([processus('claude-abc', false)]);
    expect(requetes[0]?.fermee).toBe(true);
    expect(session.resume.terminal).toBe(true);
  });

  test('un processus sur une autre conversation ne touche pas la session', async () => {
    const { session, requetes } = nouvelleSession(async () => []);
    await session.lancer('un');
    balayageAvec(session).cederTenues([processus('autre-conversation', false)]);
    expect(requetes[0]?.fermee).toBe(false);
    expect(session.vivante).toBe(true);
  });
});
