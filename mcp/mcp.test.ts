import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Projet, ResumeSession } from '../commun/session.ts';
import { lireConfig } from './bin.ts';
import { ClientRelais, ErreurRelais } from './client-relais.ts';
import { texteFil, texteParc, trouverProjet } from './format.ts';

const projets: Projet[] = [
  { machine: 'tour', chemin: '/mnt/projects/ccremote-dev', nom: 'ccremote-dev' },
  { machine: 'tour', chemin: '/mnt/projects/ccremote', nom: 'ccremote' },
  { machine: 'tour', chemin: '/mnt/projects/palabre', nom: 'palabre' },
];

function session(statut: ResumeSession['statut'], id = 's1'): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: projets[0] as Projet,
    cwd: '/mnt/projects/ccremote-dev',
    titre: 'essai',
    objectif: null,
    modele: 'opus',
    compte: 'principal',
    autonomie: true,
    statut,
    contexte: { tokens: 50_000, max: 200_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: 'claude-ccremote-dev',
    attachee: false,
    pilotee: true,
    creeLe: '2026-11-05T10:00:00.000Z',
    majLe: '2026-11-05T10:00:00.000Z',
  };
}

describe('trouverProjet', () => {
  test('nom exact prioritaire sur une inclusion', () => {
    expect(trouverProjet('tour', 'ccremote', projets)).toEqual(projets[1] as Projet);
  });
  test('inclusion unique acceptée', () => {
    expect(trouverProjet('tour', 'pala', projets)).toEqual(projets[2] as Projet);
  });
  test('ambiguïté et absence → message', () => {
    expect(trouverProjet('tour', 'remote', projets)).toContain('ambigu');
    expect(trouverProjet('tour', 'inconnu', projets)).toContain('introuvable');
  });
  test('chemin absolu hors liste accepté tel quel', () => {
    expect(trouverProjet('tour', '/home/trinity/x', projets)).toEqual({
      machine: 'tour',
      chemin: '/home/trinity/x',
      nom: 'x',
    });
  });
});

describe('format', () => {
  test('parc : sessions vivantes seulement par défaut, réveil signalé', () => {
    const etat = {
      machines: [{ id: 'tour', description: 'PC', enLigne: false }],
      sessions: [session('travail', 'vive'), session('fermee', 'morte')],
      reveilPossible: ['tour'],
    };
    const t = texteParc(etat, false);
    expect(t).toContain('vive');
    expect(t).not.toContain('morte');
    expect(t).toContain('quart_reveiller');
    expect(t).toContain('contexte 25 %');
  });
  test('fil : outils masqués sans détail, sous-agents ignorés, dernier seq', () => {
    const ts = '2026-11-05T10:00:00.000Z';
    const { texte, dernier } = texteFil(
      [
        { seq: 3, ts, evt: { type: 'texte', texte: 'bonjour' } },
        { seq: 4, ts, evt: { type: 'outil', id: 'o', nom: 'Bash', resume: 'ls', detail: '' } },
        { seq: 5, ts, evt: { type: 'texte', texte: 'interne', agent: 'a' } },
        { seq: 6, ts, evt: { type: 'tour_fini', dureeMs: 4200, contexte: 1 } },
      ],
      false,
    );
    expect(texte).toContain('CLAUDE > bonjour');
    expect(texte).not.toContain('Bash');
    expect(texte).not.toContain('interne');
    expect(dernier).toBe(6);
  });
});

describe('lireConfig', () => {
  test('fichier lu, environnement prioritaire', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'quart-mcp-')), 'mcp.env');
    writeFileSync(f, "QUART_URL='https://relais.example.com/'\nQUART_JETON=abc\n");
    expect(lireConfig({}, f)).toEqual({ url: 'https://relais.example.com', jeton: 'abc' });
    expect(lireConfig({ QUART_JETON: 'env' }, f).jeton).toBe('env');
    expect(() => lireConfig({}, '/inexistant')).toThrow('QUART_URL');
  });
});

describe('ClientRelais', () => {
  let serveur: ReturnType<typeof Bun.serve>;
  const recus: { chemin: string; auth: string | null; corps: string }[] = [];
  beforeAll(() => {
    serveur = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const auth = req.headers.get('authorization');
        recus.push({ chemin: url.pathname + url.search, auth, corps: await req.text() });
        if (url.pathname === '/api/etat') return Response.json({ machines: [], sessions: [], reveilPossible: [] });
        if (url.pathname === '/api/sessions') return Response.json({ erreur: 'compte inconnu' }, { status: 502 });
        return new Response('', { status: 401 });
      },
    });
  });
  afterAll(() => serveur.stop(true));

  test('jeton porteur envoyé, JSON rendu', async () => {
    const c = new ClientRelais(`http://localhost:${serveur.port}`, 'j1');
    expect((await c.etat()).machines).toEqual([]);
    expect(recus.at(-1)?.auth).toBe('Bearer j1');
  });
  test('erreur du relais remontée avec son message', async () => {
    const c = new ClientRelais(`http://localhost:${serveur.port}`, 'j1');
    const p = c.ouvrir({ machine: 'tour', projet: projets[0] as Projet, message: 'x' });
    await expect(p).rejects.toBeInstanceOf(ErreurRelais);
    await expect(p).rejects.toThrow('compte inconnu (502)');
    expect(JSON.parse(recus.at(-1)?.corps ?? '{}').message).toBe('x');
  });
  test('401 → message de réémission', async () => {
    const c = new ClientRelais(`http://localhost:${serveur.port}`, 'mauvais');
    await expect(c.evenements('s1', 2, 0)).rejects.toThrow('réémettre');
    expect(recus.at(-1)?.chemin).toBe('/api/sessions/s1/evenements?apres=2&attendre=0');
  });
});
