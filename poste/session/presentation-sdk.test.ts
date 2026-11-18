import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { Stockage } from '../presentation/stockage.ts';
import { journal, persistee, RequeteFausse, traduction } from './faux-sdk.ts';
import { type EnvironnementSdk, type FabriqueRequete, SessionSdk } from './session-sdk.ts';

function sessionAvec(presentation: boolean): { session: SessionSdk; options: Options[] } {
  const options: Options[] = [];
  const fabrique: FabriqueRequete = (p) => {
    options.push(p.options);
    return new RequeteFausse(p.prompt, p.options, async () => [], []);
  };
  const env: EnvironnementSdk = {
    journal,
    sortie: { evenement: () => undefined, resume: () => undefined },
    executable: null,
    requete: fabrique,
    traduction,
    socket: '/run/poste.sock',
    delaiMcpMs: 200,
    periodeMcpMs: 1,
    ...(presentation
      ? { presentation: { stockage: new Stockage(mkdtempSync(join(tmpdir(), 'pres-sdk-'))), racines: ['/projets'] } }
      : {}),
  };
  return { session: new SessionSdk(persistee(null), env), options };
}

const PIECE = { nom: 'note.txt', mime: 'text/plain', base64: 'aGk=' };

describe('SessionSdk et la présentation', () => {
  test('la requête reçoit le serveur lanterne à côté du serveur de rythme', async () => {
    const { session, options } = sessionAvec(true);
    await session.lancer('bonjour');
    expect(Object.keys(options[0]?.mcpServers ?? {}).sort()).toEqual(['ccremote', 'lanterne']);
  });

  test('sans présentation, pas de serveur lanterne', async () => {
    const { session, options } = sessionAvec(false);
    await session.lancer('bonjour');
    expect(Object.keys(options[0]?.mcpServers ?? {})).toEqual(['ccremote']);
  });

  test('des pièces jointes sans présentation sont refusées, sans rien envoyer', async () => {
    const { session } = sessionAvec(false);
    await session.lancer('bonjour');
    expect(await session.envoyer('voilà', [PIECE])).toBe('pièces jointes non prises en charge par cette session');
  });

  test('des pièces jointes à une session fermée demandent de la reprendre d’abord', async () => {
    const { session } = sessionAvec(true);
    expect(await session.envoyer('voilà', [PIECE])).toBe(
      'session fermée : la reprendre avant d’y joindre des fichiers',
    );
  });
});
