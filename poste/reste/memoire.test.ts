// Responsabilité : tests de la lecture de la mémoire Hippocampe depuis le poste, contre un faux serveur MCP local.
// Vérifie la liste blanche (seuls hippo_fiche, hippo_recap, project_list), les formats JSON et SSE, et l'absence de fuite
// des en-têtes (jetons) dans les messages et les journaux.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { lireMemoire } from './memoire.ts';

const SECRET = 'JETON-SECRET-ESSAI';
const appels: {
  methode: string;
  outil: string | null;
  arguments: unknown;
  session: string | null;
  auth: string | null;
}[] = [];
let serveur: ReturnType<typeof Bun.serve> | null = null;
let dossier = '';
let sse = false;
let refus = false;
const journaux: string[] = [];
const journal = {
  warn: (...args: unknown[]) => journaux.push(JSON.stringify(args)),
  error: (...args: unknown[]) => journaux.push(JSON.stringify(args)),
} as unknown as Logger;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'memoire-'));
  sse = false;
  refus = false;
  appels.length = 0;
  journaux.length = 0;
  serveur = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: traiter });
});
afterEach(() => {
  serveur?.stop(true);
  rmSync(dossier, { recursive: true, force: true });
});

async function traiter(req: Request): Promise<Response> {
  if (refus) return new Response('erreur interne', { status: 500 });
  const corps = (await req.json()) as { id?: number; method: string; params?: { name?: string; arguments?: unknown } };
  const session = req.headers.get('mcp-session-id');
  const auth = req.headers.get('authorization');
  if (corps.method === 'notifications/initialized') return new Response(null, { status: 202 });
  const outil = corps.method === 'tools/call' ? (corps.params?.name ?? null) : null;
  appels.push({ methode: corps.method, outil, arguments: corps.params?.arguments, session, auth });
  const result =
    corps.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'faux', version: '1' } }
      : { content: [{ type: 'text', text: `réponse de ${outil}` }] };
  const message = { jsonrpc: '2.0', id: corps.id, result };
  const entetes: Record<string, string> = corps.method === 'initialize' ? { 'mcp-session-id': 'session-1' } : {};
  if (sse) {
    return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
      headers: { ...entetes, 'content-type': 'text/event-stream' },
    });
  }
  return Response.json(message, { headers: entetes });
}

function urlServeur(): string {
  return `http://127.0.0.1:${serveur?.port}/mcp`;
}

function configuration(serveurs: Record<string, unknown>): string {
  const chemin = join(dossier, '.claude.json');
  writeFileSync(chemin, JSON.stringify({ mcpServers: serveurs }));
  return chemin;
}

function hippocampe(headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }): Record<string, unknown> {
  return { type: 'http', url: urlServeur(), headers };
}

describe('mémoire Hippocampe lue depuis le poste', () => {
  test('fiche : appelle hippo_fiche avec le sujet, et rien d autre', async () => {
    const chemin = configuration({ 'semantic-memory': hippocampe() });
    const r = await lireMemoire({ outil: 'fiche', projet: 'lanterne' }, chemin, journal);
    expect(r).toEqual({ etat: 'ok', outil: 'fiche', texte: 'réponse de hippo_fiche' });
    const outils = appels.filter((a) => a.outil !== null);
    expect(outils).toEqual([expect.objectContaining({ outil: 'hippo_fiche', arguments: { sujet: 'lanterne' } })]);
  });

  test('récap : hippo_recap avec 7 jours par défaut, puis le nombre demandé', async () => {
    const chemin = configuration({ 'semantic-memory': hippocampe() });
    await lireMemoire({ outil: 'recap' }, chemin, journal);
    await lireMemoire({ outil: 'recap', jours: 30 }, chemin, journal);
    const args = appels.filter((a) => a.outil === 'hippo_recap').map((a) => a.arguments);
    expect(args).toEqual([{ jours: 7 }, { jours: 30 }]);
  });

  test('projets : project_list sans argument', async () => {
    const chemin = configuration({ 'semantic-memory': hippocampe() });
    await lireMemoire({ outil: 'projets' }, chemin, journal);
    expect(appels.find((a) => a.outil !== null)).toMatchObject({ outil: 'project_list', arguments: {} });
  });

  test('l en-tête d autorisation et l identifiant de session sont relayés, sans être rendus', async () => {
    const chemin = configuration({ 'semantic-memory': hippocampe() });
    const r = await lireMemoire({ outil: 'projets' }, chemin, journal);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    const enAppel = appels.find((a) => a.outil !== null);
    expect(enAppel?.auth).toBe(`Bearer ${SECRET}`);
    expect(enAppel?.session).toBe('session-1');
  });

  test('réponse en SSE lue comme en JSON', async () => {
    sse = true;
    const chemin = configuration({ 'semantic-memory': hippocampe() });
    expect(await lireMemoire({ outil: 'projets' }, chemin, journal)).toEqual({
      etat: 'ok',
      outil: 'projets',
      texte: 'réponse de project_list',
    });
  });

  test('un serveur au nom qui évoque la mémoire est pris à défaut de semantic-memory', async () => {
    const chemin = configuration({ 'mon-hippocampe': hippocampe(), autre: { type: 'stdio', command: 'x' } });
    expect(await lireMemoire({ outil: 'projets' }, chemin, journal)).toMatchObject({ etat: 'ok' });
  });

  test('absente : pas de fichier, ou pas de serveur http de mémoire', async () => {
    const manquant = join(dossier, 'absent.json');
    expect(await lireMemoire({ outil: 'projets' }, manquant, journal)).toMatchObject({ etat: 'absente' });
    const sansMemoire = configuration({ 'semantic-memory': { type: 'stdio', command: 'x' } });
    expect(await lireMemoire({ outil: 'projets' }, sansMemoire, journal)).toMatchObject({ etat: 'absente' });
    expect(appels).toHaveLength(0);
  });

  test('fiche sans projet : refus avant tout appel', async () => {
    const chemin = configuration({ 'semantic-memory': hippocampe() });
    expect(await lireMemoire({ outil: 'fiche' }, chemin, journal)).toEqual({
      etat: 'erreur',
      raison: 'projet attendu pour la fiche',
    });
    expect(appels).toHaveLength(0);
  });

  test('erreur HTTP : message sans en-tête ni jeton, et journal sans jeton', async () => {
    refus = true;
    const chemin = configuration({ 'semantic-memory': hippocampe() });
    const r = await lireMemoire({ outil: 'projets' }, chemin, journal);
    expect(r).toEqual({ etat: 'erreur', raison: 'Hippocampe a répondu HTTP 500' });
    expect(journaux.join('\n')).not.toContain(SECRET);
  });
});
