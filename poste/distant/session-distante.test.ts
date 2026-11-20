import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import type { SortieSession } from '../session/session-poste.ts';
import { demarrerFauxApi, type FauxApi, sessionApi, tourApi } from './faux-claude-ai.ts';
import { type SessionBrute, lireSession } from './donnees.ts';
import { SessionDistante, PAS_ENCORE_CLAUDE_AI } from './session-distante.ts';
import { estMessageSdk, traduireLot } from './traduction-distante.ts';
import { nouvelEtatTraduction } from '../session/traduction-sdk.ts';

const JETON = 'jeton-factice-session-distante';
const journal = pino({ enabled: false });

let api: FauxApi;
let dossier: string;

function bruteDe(id: string, surcharge: Record<string, unknown> = {}): SessionBrute {
  const s = lireSession(sessionApi(id, surcharge));
  if (!s) throw new Error('session de test invalide');
  return s;
}

function sortieDeTest(): {
  sortie: SortieSession;
  evenements: Evenement[];
  historiques: EvenementHorodate[][];
} {
  const evenements: Evenement[] = [];
  const historiques: EvenementHorodate[][] = [];
  const sortie: SortieSession = {
    evenement: (_id: string, evt: Evenement) => void evenements.push(evt),
    historique: (_id: string, evts: readonly EvenementHorodate[]) => void historiques.push([...evts]),
    resume: (_r: ResumeSession) => undefined,
  };
  return { sortie, evenements, historiques };
}

function creer(brute: SessionBrute): {
  s: SessionDistante;
  evenements: Evenement[];
  historiques: EvenementHorodate[][];
} {
  const { sortie, evenements, historiques } = sortieDeTest();
  const contexte = { machine: 'tour', compte: 'principal', fenetreContexte: 1_000_000 };
  const s = new SessionDistante({ contexte, configDir: dossier, journal, sortie }, brute);
  return { s, evenements, historiques };
}

const textes = (evts: readonly Evenement[]): string[] => evts.flatMap((e) => (e.type === 'texte' ? [e.texte] : []));

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-session-distante-'));
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    join(dossier, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: JETON, expiresAt: Date.now() + 3_600_000 } }),
  );
});

afterEach(() => {
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  rmSync(dossier, { recursive: true, force: true });
});

describe('historique d’une session claude.ai', () => {
  test('les événements sont émis en un lot, dans l’ordre d’origine, traduits du SDK', async () => {
    // Le fil est servi du plus récent au plus ancien, comme l'API.
    api.fils.set('cse_h', [...tourApi(3, 'Troisième'), ...tourApi(2, 'Deuxième'), ...tourApi(1, 'Premier')]);
    const { s, evenements, historiques } = creer(bruteDe('cse_h'));
    const r = await s.charger();
    expect(r.ok).toBe(true);
    expect(historiques).toHaveLength(1);
    expect(textes(historiques[0]?.map((h) => h.evt) ?? [])).toEqual(['Premier', 'Deuxième', 'Troisième']);
    expect(evenements).toHaveLength(0);
    expect(s.vivante).toBe(true);
    expect(s.persistee.resume.id).toBe('cse_h');
    expect(s.resume.moteur).toBe('claude_ai');
  });

  test('un fil vide n’émet pas de lot', async () => {
    const { s, historiques } = creer(bruteDe('cse_vide'));
    expect(await s.charger()).toEqual({ ok: true, donnees: 0 });
    expect(historiques).toHaveLength(0);
  });

  test('un payload qui n’est pas un message du SDK est ignoré sans erreur', () => {
    const traduits = traduireLot(
      [
        { id: 'x', creeLe: 't', payload: { pas: 'un message' } },
        { id: 'y', creeLe: 't', payload: 'texte brut' },
      ],
      nouvelEtatTraduction(),
    );
    expect(traduits).toEqual([]);
    expect(estMessageSdk({ type: 'assistant' })).toBe(true);
    expect(estMessageSdk(null)).toBe(false);
  });
});

describe('suivi en direct d’une session claude.ai', () => {
  test('un nouvel événement est émis une seule fois', async () => {
    api.fils.set('cse_d', tourApi(1, 'Premier'));
    const { s, evenements } = creer(bruteDe('cse_d'));
    expect(await s.synchroniser(bruteDe('cse_d'))).toBeNull();

    api.fils.set('cse_d', [...tourApi(2, 'Deuxième'), ...tourApi(1, 'Premier')]);
    expect(await s.synchroniser(bruteDe('cse_d', { last_event_at: '2026-11-20T10:02:00.000Z' }))).toBeNull();
    expect(textes(evenements)).toEqual(['Deuxième']);

    expect(await s.synchroniser(bruteDe('cse_d', { last_event_at: '2026-11-20T10:02:00.000Z' }))).toBeNull();
    expect(textes(evenements)).toEqual(['Deuxième']);
  });

  test('une lecture échouée ne fait pas perdre le repère : le tour suivant reprend', async () => {
    api.fils.set('cse_e', tourApi(1, 'Premier'));
    const { s, evenements } = creer(bruteDe('cse_e'));
    await s.synchroniser(bruteDe('cse_e'));
    api.fils.set('cse_e', [...tourApi(2, 'Deuxième'), ...tourApi(1, 'Premier')]);
    const suivante = bruteDe('cse_e', { last_event_at: '2026-11-20T10:02:00.000Z' });
    api.statutForce = 500;
    expect(await s.synchroniser(suivante)).toBe('réponse HTTP 500 de claude.ai');
    api.statutForce = null;
    expect(await s.synchroniser(suivante)).toBeNull();
    expect(textes(evenements)).toEqual(['Deuxième']);
  });

  test('les commandes de pilotage ne sont pas prises en charge', async () => {
    const { s } = creer(bruteDe('cse_c'));
    expect(await s.envoyer()).toBe(PAS_ENCORE_CLAUDE_AI);
    expect(await s.interrompre()).toBe(PAS_ENCORE_CLAUDE_AI);
    expect(s.rythme()).toBe(PAS_ENCORE_CLAUDE_AI);
  });

  test('la publication ne repart que sur changement ; une session rangée passe fermée', () => {
    const { s } = creer(bruteDe('cse_p'));
    expect(s.resumePourPublication()).not.toBeNull();
    expect(s.resumePourPublication()).toBeNull();
    s.passerFermee();
    expect(s.resumePourPublication()?.statut).toBe('fermee');
    expect(s.vivante).toBe(false);
  });
});
