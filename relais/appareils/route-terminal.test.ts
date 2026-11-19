// Le terminal d'une session : la route résout la machine et le dossier de la session, passe en WebSocket, et
// l'entrée, la taille et la sortie suivent le poste de la session.
import { describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { ouvrirTerminalSession } from './route-terminal.ts';
import type { Acces } from '../acces/acces.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';

const SESSION = {
  id: 's1',
  machine: 'machine-a',
  cwd: '/srv/projets/demo',
};

describe('terminal de session (relais)', () => {
  test('session inconnue : 404, aucun poste sollicité', () => {
    const r = ouvrirTerminalSession(
      new Request('http://relais/api/sessions/x/terminal'),
      { upgrade: () => true } as unknown as Server<unknown>,
      { autorise: () => true } as unknown as Acces,
      { enLigne: () => true } as unknown as Postes,
      { session: () => null },
      'x',
    );
    expect(r?.status).toBe(404);
  });

  test('session sur un poste hors ligne : refus lisible', () => {
    const r = ouvrirTerminalSession(
      new Request('http://relais/api/sessions/s1/terminal'),
      { upgrade: () => true } as unknown as Server<unknown>,
      { autorise: () => true } as unknown as Acces,
      { enLigne: () => false } as unknown as Postes,
      { session: () => SESSION as never } as Pick<Registre, 'session'>,
      's1',
    );
    expect(r?.status).toBe(409);
  });

  test('session sans jeton : 401', () => {
    const r = ouvrirTerminalSession(
      new Request('http://relais/api/sessions/s1/terminal'),
      { upgrade: () => true } as unknown as Server<unknown>,
      { autorise: () => false } as unknown as Acces,
      { enLigne: () => true } as unknown as Postes,
      { session: () => SESSION as never } as Pick<Registre, 'session'>,
      's1',
    );
    expect(r?.status).toBe(401);
  });

  test('session en ligne : la WebSocket reçoit les données de la machine et du dossier de la session', () => {
    let recue: unknown;
    const r = ouvrirTerminalSession(
      new Request('http://relais/api/sessions/s1/terminal?colonnes=120&lignes=40'),
      { upgrade: (_req: Request, options: { data: unknown }) => ((recue = options.data), true) } as unknown as Server<unknown>,
      { autorise: () => true } as unknown as Acces,
      { enLigne: () => true } as unknown as Postes,
      { session: () => SESSION as never } as Pick<Registre, 'session'>,
      's1',
    );
    expect(r).toBeUndefined();
    expect(recue).toMatchObject({
      type: 'terminal',
      machine: 'machine-a',
      cible: { type: 'shell', dossier: '/srv/projets/demo' },
      colonnes: 120,
      lignes: 40,
    });
  });
});
