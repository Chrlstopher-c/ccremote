import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Acces } from '../acces/acces.ts';
import { routesAcces } from '../acces/api-acces.ts';
import { PlafondEchecs } from '../acces/plafond.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { adresseBoucle, routesMcp } from './mcp-http.ts';

const journal = pino({ level: 'silent' });
const registre = new Registre(ouvrirBase(':memory:'), journal);
let acces: Acces;
let serveur: ReturnType<typeof Bun.serve>;
let base = '';
let jetonAppareil = '';

beforeAll(async () => {
  const empreinte = await Bun.password.hash('bon', { algorithm: 'bcrypt', cost: 4 });
  const fichier = join(mkdtempSync(join(tmpdir(), 'ccremote-mcp-')), 'echecs.json');
  acces = new Acces(registre, empreinte, new PlafondEchecs(fichier, journal));
  const r = await acces.connecter('bon', 'ip', 'Quart bureau');
  if (!r.ok) throw new Error('connexion');
  jetonAppareil = r.jeton;
  serveur = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: {
      ...routesAcces(acces, journal),
      ...routesMcp(acces, adresseBoucle('127.0.0.1', 1), journal),
      '/api/etat': () => Response.json({ machines: [], sessions: [], reveilPossible: [] }),
    },
    fetch: () => new Response('index', { status: 200 }),
  });
  base = `http://127.0.0.1:${serveur.port}`;
});
afterAll(() => serveur.stop(true));

const auth = (j: string) => ({ authorization: `Bearer ${j}`, 'content-type': 'application/json' });

describe('gestion des accès', () => {
  test('émettre, lister (courant marqué), révoquer', async () => {
    const r = await fetch(`${base}/api/acces`, {
      method: 'POST',
      headers: auth(jetonAppareil),
      body: JSON.stringify({ nom: 'claude.ai perso', genre: 'claude-ai', jours: 30 }),
    });
    expect(r.status).toBe(201);
    const { id, jeton } = (await r.json()) as { id: string; jeton: string };
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    const liste = (await (await fetch(`${base}/api/acces`, { headers: auth(jetonAppareil) })).json()) as {
      id: string;
      genre: string;
      courant: boolean;
    }[];
    expect(liste.find((a) => a.id === id)?.genre).toBe('claude-ai');
    expect(liste.filter((a) => a.courant)).toHaveLength(1);
    // un connecteur ne gère pas les accès
    expect((await fetch(`${base}/api/acces`, { headers: auth(jeton) })).status).toBe(403);
    const rev = await fetch(`${base}/api/acces/${id}/revoquer`, { method: 'POST', headers: auth(jetonAppareil) });
    expect(rev.status).toBe(200);
    expect(acces.genreDuJeton(jeton)).toBeNull();
  });
  test('id trop court ou mal formé refusé (jamais de révocation en masse)', () => {
    expect(acces.revoquer('')).toBe(false);
    expect(acces.revoquer('abc')).toBe(false);
    expect(acces.genreDuJeton(jetonAppareil)).toBe('appareil');
  });
});

describe('MCP en HTTP', () => {
  const initialiser = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'essai', version: '1' } },
  };
  const entetesMcp = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

  test('jeton dans l’URL : initialize puis tools/list', async () => {
    const { jeton } = acces.emettre({ nom: 'x', genre: 'claude-ai', jours: 1 });
    const init = await fetch(`${base}/mcp/${jeton}`, {
      method: 'POST',
      headers: entetesMcp,
      body: JSON.stringify(initialiser),
    });
    expect(init.status).toBe(200);
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('quart');
    const liste = await fetch(`${base}/mcp/${jeton}`, {
      method: 'POST',
      headers: entetesMcp,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const outils = ((await liste.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(outils).toContain('quart_ouvrir');
  });
  test('Bearer sur /mcp accepté ; jeton inconnu → 401', async () => {
    const { jeton } = acces.emettre({ nom: 'cc', genre: 'claude-code', jours: 1 });
    const ok = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...entetesMcp, authorization: `Bearer ${jeton}` },
      body: JSON.stringify(initialiser),
    });
    expect(ok.status).toBe(200);
    const ko = await fetch(`${base}/mcp/faux`, { method: 'POST', headers: entetesMcp, body: '{}' });
    expect(ko.status).toBe(401);
    expect((await fetch(`${base}/.well-known/oauth-protected-resource`)).status).toBe(404);
  });
  test('adresse de boucle IPv6 entre crochets', () => {
    expect(adresseBoucle('::1', 8766)).toBe('http://[::1]:8766');
  });
});
