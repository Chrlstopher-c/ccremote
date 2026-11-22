import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ApiVoix, urlVoix } from './api-voix.ts';

const journal = pino({ level: 'silent' });
const demande = (texte: string, requete = '') =>
  new Request(`http://noeud.interne/api/voix${requete}`, { method: 'POST', body: JSON.stringify({ texte }) });

let service: ReturnType<typeof Bun.serve>;
let recu = '';
beforeAll(() => {
  service = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      recu = await req.text();
      return new Response(new Uint8Array([0xff, 0xfb, 1, 2]), { headers: { 'content-type': 'audio/mpeg' } });
    },
  });
});
afterAll(() => void service.stop(true));

describe('ApiVoix', () => {
  test('service local : audio rendu tel quel', async () => {
    const api = new ApiVoix(`http://127.0.0.1:${service.port}`, { voixDesPairs: async () => null }, journal);
    const r = await api.synthese(demande('  Bonjour.  '));
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xfb, 1, 2]));
    expect(JSON.parse(recu)).toEqual({ texte: 'Bonjour.' });
  });

  test('sans service : relayé aux pairs, jamais plus loin depuis un pair', async () => {
    let relaye = '';
    const pairs = { voixDesPairs: async (c: string) => ((relaye = c), new Response('son')) };
    const api = new ApiVoix(null, pairs, journal);
    expect(await (await api.synthese(demande('Salut.'))).text()).toBe('son');
    expect(JSON.parse(relaye)).toEqual({ texte: 'Salut.' });
    expect((await api.synthese(demande('Salut.', '?local=1'))).status).toBe(503);
  });

  test('aucun pair, texte vide', async () => {
    const api = new ApiVoix(null, { voixDesPairs: async () => null }, journal);
    expect((await api.synthese(demande('Salut.'))).status).toBe(503);
    expect((await api.synthese(demande(''))).status).toBe(400);
  });

  test('adresse : variable, puis fichier, sinon rien', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'voix-'));
    expect(urlVoix({}, dossier)).toBeNull();
    writeFileSync(join(dossier, 'voix.url'), 'http://127.0.0.1:1/\n');
    expect(urlVoix({}, dossier)).toBe('http://127.0.0.1:1');
    expect(urlVoix({ LANTERNE_VOIX_URL: 'http://a.example' }, dossier)).toBe('http://a.example');
    rmSync(dossier, { recursive: true });
  });
});
