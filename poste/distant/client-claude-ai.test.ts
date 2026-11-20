import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import pino from 'pino';
import { lireEvenements, listerSessions } from './client-claude-ai.ts';
import { demarrerFauxApi, type FauxApi, evenementApi, sessionApi } from './faux-claude-ai.ts';

// Faux serveur et faux `.credentials.json` : aucun appel réseau réel, aucun jeton réel.
const JETON = 'jeton-factice-0123456789-ne-pas-utiliser';

let api: FauxApi;
let dossier: string;
let lignes: string[];
let journal: Logger;

function ecrireJeton(expireLe: number = Date.now() + 3_600_000): void {
  const contenu = { claudeAiOauth: { accessToken: JETON, expiresAt: expireLe } };
  writeFileSync(join(dossier, '.credentials.json'), JSON.stringify(contenu));
}

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-distant-'));
  mkdirSync(dossier, { recursive: true });
  ecrireJeton();
  lignes = [];
  journal = pino({ level: 'trace' }, { write: (ligne: string) => void lignes.push(ligne) });
});

afterEach(() => {
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  rmSync(dossier, { recursive: true, force: true });
});

describe('liste des sessions claude.ai', () => {
  test('envoie le jeton du compte et les en-têtes de l’API des sessions', async () => {
    api.sessions = [sessionApi('cse_1')];
    const r = await listerSessions(dossier, journal);
    expect(r.ok).toBe(true);
    const entetes = api.entetes[0];
    expect(entetes?.get('authorization')).toBe(`Bearer ${JETON}`);
    expect(entetes?.get('anthropic-version')).toBe('2023-06-01');
    expect(entetes?.get('anthropic-beta')).toBe('ccr-byoc-2025-07-29');
    expect(api.chemins[0]).toBe('/v1/code/sessions?limit=50');
  });

  test('rend les sessions lues, toutes environnements confondus', async () => {
    api.sessions = [sessionApi('cse_1'), sessionApi('cse_2', { environment_kind: 'cli' })];
    const r = await listerSessions(dossier, journal);
    expect(r.ok && r.donnees.map((s) => s.id)).toEqual(['cse_1', 'cse_2']);
  });

  test('401 : résultat typé, jeton jamais journalisé ni rendu', async () => {
    api.statutForce = 401;
    const r = await listerSessions(dossier, journal);
    expect(r).toMatchObject({ ok: false, statut: 401 });
    expect(JSON.stringify(r)).not.toContain(JETON);
    expect(lignes.join('\n')).not.toContain(JETON);
    expect(lignes.join('\n')).toContain('réponse refusée');
  });

  test('403 : le problème nomme l’appareil de confiance', async () => {
    api.statutForce = 403;
    const r = await listerSessions(dossier, journal);
    expect(r).toMatchObject({ ok: false, statut: 403 });
    expect(!r.ok && r.probleme).toContain('appareil de confiance');
  });

  test('jeton absent : aucune requête, résultat typé', async () => {
    const vide = mkdtempSync(join(tmpdir(), 'quart-distant-vide-'));
    try {
      const r = await listerSessions(vide, journal);
      expect(r).toMatchObject({ ok: false, statut: 0 });
      expect(api.chemins).toHaveLength(0);
    } finally {
      rmSync(vide, { recursive: true, force: true });
    }
  });

  test('jeton expiré : aucune requête, jamais renouvelé', async () => {
    ecrireJeton(Date.now() - 1000);
    const r = await listerSessions(dossier, journal);
    expect(r.ok).toBe(false);
    expect(api.chemins).toHaveLength(0);
  });

  test('API injoignable : résultat typé et journalisé', async () => {
    process.env['CCREMOTE_API_CLAUDE_AI'] = 'http://127.0.0.1:9';
    const r = await listerSessions(dossier, journal);
    expect(r).toMatchObject({ ok: false, statut: 0 });
    expect(lignes.join('\n')).toContain('appel en échec');
  });
});

describe('fil d’une session claude.ai', () => {
  test('lit par pages du plus récent au plus ancien, sans rien perdre', async () => {
    const fil = Array.from({ length: 150 }, (_, i) => evenementApi(`ev${i}`, { type: 'x' }, 't'));
    api.fils.set('cse_1', fil);
    const premiere = await lireEvenements(dossier, 'cse_1', journal, { limite: 100 });
    expect(premiere.ok).toBe(true);
    if (!premiere.ok) return;
    expect(premiere.donnees.evenements).toHaveLength(100);
    expect(premiere.donnees.evenements[0]?.id).toBe('ev0');
    const suite = await lireEvenements(dossier, 'cse_1', journal, {
      curseur: premiere.donnees.suivant,
      limite: 100,
    });
    expect(suite.ok && suite.donnees.evenements.map((e) => e.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => `ev${i + 100}`),
    );
    expect(api.chemins[0]).toContain('sort_order=desc');
  });
});
