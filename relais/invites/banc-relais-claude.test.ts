// Responsabilité : le relais Claude sur le banc réel — invité G (route locale, secret du relais), nœud du chef B
// (verdicts, appel de l'API avec son jeton), faux Anthropic local. Flux, jeton en amont, refus, télémétrie.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import { inviterMembre, membreDe } from '../../commun/charte.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { reglagesParDefaut, type ReglagesInvite } from '../../commun/invites.ts';
import {
  attendre,
  creerNoeud,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from '../federation/banc-federation.ts';
import type { OptionsFederation } from '../federation/federation.ts';

const JETON_CHEF = `oauth-du-chef-${'k'.repeat(40)}`;
const SSE_OK =
  'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-haiku-5-5",' +
  '"usage":{"input_tokens":120,"output_tokens":1}}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta",' +
  '"delta":{"type":"text_delta","text":"bonjour"}}\n\n' +
  'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":45}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n';
const PAUSE_LENTE_MS = 3000;

interface Amont {
  readonly chemin: string;
  readonly entetes: Headers;
  readonly corps: string;
}

let monte: Monte;
let amont: ReturnType<typeof Bun.serve>;
let noeuds: Noeud[] = [];
let racine: string;
let recues: Amont[] = [];

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
  racine = mkdtempSync(join(tmpdir(), 'relais-claude-racine-'));
  recues = [];
  amont = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const corps = await req.text();
      recues.push({ chemin: url.pathname + url.search, entetes: req.headers, corps });
      if (corps.includes('"LENT"')) await pause(PAUSE_LENTE_MS);
      if (url.pathname.endsWith('count_tokens')) return Response.json({ input_tokens: 5 });
      const gros = corps.includes('GROSGROS') ? `: ${'x'.repeat(300_000)}\n\n` : '';
      return new Response(gros + SSE_OK, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
  amont.stop(true);
  rmSync(racine, { recursive: true, force: true });
});

async function nouveau(nom: string, options: Partial<OptionsFederation> = {}): Promise<Noeud> {
  const n = creerNoeud(nom, { invitesRacine: racine, ...options });
  noeuds.push(n);
  await relier(n, monte, 'alice');
  return n;
}

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

async function appairer(a: Noeud, b: Noeud, reconnu = false): Promise<void> {
  const idB = await idDe(b);
  await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
  expect(a.federation.appairer(idB).ok).toBe(true);
  if (!reconnu) {
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    const demande = (await b.federation.etat()).demandes[0];
    expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  }
  const idA = await idDe(a);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
}

function reglagesG(surcharge: Partial<ReglagesInvite> = {}, machines: string[] = []): ReglagesInvite {
  return {
    ...reglagesParDefaut(null),
    modeles: { haiku: ['low', 'medium'] },
    part5h: 25,
    partSemaine: 25,
    simultanees: 2,
    machines,
    ...surcharge,
  };
}

interface Reseau {
  readonly a: Noeud;
  readonly b: Noeud;
  readonly g: Noeud;
  readonly idA: string;
  readonly idB: string;
  readonly idG: string;
}

/** Un chef (A, réseau), B qui fait tourner les requêtes (jeton du chef), G invité chez le chef. */
async function reseau(surcharge: Partial<ReglagesInvite> = {}, delaiClaudeMs?: number): Promise<Reseau> {
  const b = await nouveau('tour', { jetonAbonnement: () => JETON_CHEF, urlApiClaude: amont.url.origin });
  const a = await nouveau('portable', { peutReprendre: true });
  const g = await nouveau('elie', delaiClaudeMs !== undefined ? { delaiClaudeMs } : {});
  await appairer(a, b);
  const idB = await idDe(b);
  await attendre(() => b.federation.charte.charte() !== null);
  const idG = await idDe(g);
  await appairer(a, g);
  const invite = { id: idG, nom: 'Elie', identite: exporterIdentitePublique((await genererIdentite()).publique) };
  const reglages = reglagesG({ ...surcharge }, [idB]);
  const r = await a.federation.charte.editer((c, moi, le) =>
    inviterMembre(c, moi, { ...invite, identite: membreDe(c, idG)?.identite ?? invite.identite }, reglages, le),
  );
  expect(r.ok).toBe(true);
  await attendre(
    () => b.federation.charte.charte()?.membres.some((m) => m.id === idG && m.invite !== undefined) === true,
  );
  await appairer(g, b, true);
  await attendre(() => g.federation.charte.charte() !== null);
  const idA = await idDe(a);
  return { a, b, g, idA, idB, idG };
}

/** Une requête de Claude Code vers la route locale de G : le secret du relais, comme le fait Claude Code. */
function requete(g: Noeud, corps: unknown, entetes: Record<string, string> = {}, secret?: string): Request {
  return new Request('http://127.0.0.1/api/relais-claude/v1/messages?beta=true', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret ?? g.federation.relais.jetonRelais()}`,
      'content-type': 'application/json',
      'anthropic-beta': 'claude-code-20250219',
      'x-claude-code-session-id': 'session-1',
      ...entetes,
    },
    body: JSON.stringify(corps),
  });
}

const MESSAGE = { model: 'claude-haiku-5-5', stream: true, output_config: { effort: 'low' }, messages: [] };
const corpsDe = (surcharge: Record<string, unknown> = {}) => ({ ...MESSAGE, ...surcharge });

describe('relais Claude : le chemin complet', () => {
  test('la réponse arrive en flux ; le jeton du chef part en amont, jamais le jeton local', async () => {
    const r = await reseau();
    const rep = await r.g.federation.relais.client.routeLocale(requete(r.g, corpsDe()));
    expect(rep.status).toBe(200);
    expect(rep.headers.get('content-type')).toBe('text/event-stream');
    const texte = await rep.text();
    expect(texte).toContain('bonjour');
    expect(texte).toContain('message_stop');
    expect(recues).toHaveLength(1);
    const envoi = recues[0];
    expect(envoi?.chemin).toBe('/v1/messages?beta=true');
    expect(envoi?.entetes.get('authorization')).toBe(`Bearer ${JETON_CHEF}`);
    expect(envoi?.entetes.get('anthropic-beta')).toBe('claude-code-20250219,oauth-2025-04-20');
    expect(JSON.stringify([...(envoi?.entetes.entries() ?? [])])).not.toContain(r.g.federation.relais.jetonRelais());
    expect(JSON.parse(envoi?.corps ?? '{}')).toEqual(corpsDe());
  });

  test('un corps et une réponse plus grands qu’une trame passent en morceaux, dans les deux sens', async () => {
    const r = await reseau();
    const contenu = 'GROS'.repeat(60_000);
    const envoye = corpsDe({ messages: [{ role: 'user', content: contenu }] });
    const rep = await r.g.federation.relais.client.routeLocale(requete(r.g, envoye));
    expect(rep.status).toBe(200);
    const texte = await rep.text();
    expect(texte).toContain('message_stop');
    expect(texte.length).toBeGreaterThan(300_000);
    expect(JSON.parse(recues[0]?.corps ?? '{}')).toEqual(envoye);
  });

  test('la consommation (entrée, sortie, modèle) est comptée chez le chef, sans contenu', async () => {
    const r = await reseau();
    await (await r.g.federation.relais.client.routeLocale(requete(r.g, corpsDe()))).text();
    r.b.federation.invites.emettreActivites();
    await attendre(() => r.a.federation.invites.activitePour(r.idG).activite?.requetesAujourdhui === 1, 4000);
    const act = r.a.federation.invites.activitePour(r.idG).activite;
    expect(act?.jetonsAujourdhui).toBe(165);
    expect(act?.sessionsAujourdhui).toBe(1);
    expect(act?.dernierModele).toBe('claude-haiku-5-5');
  });

  test('un jeton local faux : 401 au format Anthropic, rien ne part', async () => {
    const r = await reseau();
    const rep = await r.g.federation.relais.client.routeLocale(requete(r.g, corpsDe(), {}, 'faux'));
    expect(rep.status).toBe(401);
    expect(JSON.parse(await rep.text())).toMatchObject({ type: 'error', error: { type: 'authentication_error' } });
    expect(recues).toHaveLength(0);
  });

  test('la route répond 200 sans secret à HEAD /api/hello (test de connectivité de Claude Code)', async () => {
    const r = await reseau();
    const rep = await r.g.federation.relais.client.routeLocale(
      new Request('http://127.0.0.1/api/relais-claude/api/hello', { method: 'HEAD' }),
    );
    expect(rep.status).toBe(200);
  });
});

describe('relais Claude : les refus côté chef', () => {
  test('opus refusé en 403 permission_error, aucun appel à l’API', async () => {
    const r = await reseau();
    const rep = await r.g.federation.relais.client.routeLocale(requete(r.g, corpsDe({ model: 'claude-opus-5' })));
    expect(rep.status).toBe(403);
    expect(JSON.parse(await rep.text())).toMatchObject({ error: { type: 'permission_error' } });
    expect(recues).toHaveLength(0);
  });

  test('effort medium refusé quand seul high est permis pour haiku', async () => {
    const r = await reseau({ modeles: { haiku: ['high'] } });
    const medium = await r.g.federation.relais.client.routeLocale(
      requete(r.g, corpsDe({ output_config: { effort: 'medium' } })),
    );
    expect(medium.status).toBe(403);
    const haut = await r.g.federation.relais.client.routeLocale(
      requete(r.g, corpsDe({ output_config: { effort: 'high' } })),
    );
    expect(haut.status).toBe(200);
    await haut.text();
    expect(recues).toHaveLength(1);
  });

  test('un pair qui n’est pas invité n’obtient rien : 403, aucun appel', async () => {
    const r = await reseau();
    const envoyes: MessageChiffre[] = [];
    const canal = { membre: r.idA, envoyer: (m: MessageChiffre) => (envoyes.push(m), true) };
    const corps = Buffer.from(JSON.stringify(corpsDe())).toString('base64');
    r.b.federation.relais.messageRecu(canal, {
      t: 'claude_requete',
      ref: 'ref-non-invite',
      methode: 'POST',
      chemin: '/v1/messages',
      entetes: { 'content-type': 'application/json' },
      corps,
    });
    await attendre(() => envoyes.some((m) => m.t === 'claude_fin'));
    expect(envoyes.find((m) => m.t === 'claude_entete')).toMatchObject({ statut: 403 });
    expect(recues).toHaveLength(0);
  });

  test('une troisième session simultanée est refusée en 429, une session déjà vue passe', async () => {
    const r = await reseau({ simultanees: 2 });
    for (const session of ['session-a', 'session-b']) {
      const rep = await r.g.federation.relais.client.routeLocale(
        requete(r.g, corpsDe(), { 'x-claude-code-session-id': session }),
      );
      expect(rep.status).toBe(200);
      await rep.text();
    }
    const troisieme = await r.g.federation.relais.client.routeLocale(
      requete(r.g, corpsDe(), { 'x-claude-code-session-id': 'session-c' }),
    );
    expect(troisieme.status).toBe(429);
    const revue = await r.g.federation.relais.client.routeLocale(
      requete(r.g, corpsDe(), { 'x-claude-code-session-id': 'session-a' }),
    );
    expect(revue.status).toBe(200);
    await revue.text();
  });

  test('count_tokens passe par la même politique et répond sans flux', async () => {
    const r = await reseau();
    const rep = await r.g.federation.relais.client.routeLocale(
      new Request('http://127.0.0.1/api/relais-claude/v1/messages/count_tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${r.g.federation.relais.jetonRelais()}`, 'content-type': 'application/json' },
        body: JSON.stringify(corpsDe()),
      }),
    );
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ input_tokens: 5 });
  });
});

describe('relais Claude : délai et annulation côté invité', () => {
  test('pas de premier octet dans le délai : 504 au format Anthropic', async () => {
    const r = await reseau({}, 200);
    const rep = await r.g.federation.relais.client.routeLocale(
      requete(r.g, corpsDe({ messages: [{ role: 'user', content: 'LENT' }] })),
    );
    expect(rep.status).toBe(504);
    expect(JSON.parse(await rep.text())).toMatchObject({ error: { type: 'api_error' } });
  });
});
