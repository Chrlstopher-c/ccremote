import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Logger } from 'pino';
import type { ConfigPoste } from '../config.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import { demarrerFauxApi, type FauxApi, sessionApi, tourApi } from '../distant/faux-claude-ai.ts';
import type { EvenementHorodate } from './historique.ts';
import { GestionnaireSessions } from './gestionnaire.ts';
import type { SortieSession } from './session-poste.ts';

// Le gestionnaire du poste face à une session Remote Control suivie : trace de relais, garde des commandes, historique
// où la trace reprend sa place. Faux serveur claude.ai ; rien n'est envoyé au vrai service.
const JETON = 'jeton-factice-gestionnaire-distant';
const ID = 'cse_gest';

let api: FauxApi;
let dossier: string;
let journal: Logger;
let evenements: Evenement[];
let historiques: EvenementHorodate[][];
let gestionnaire: GestionnaireSessions;

const sortie: SortieSession = {
  evenement: (_id: string, evt: Evenement) => void evenements.push(evt),
  historique: (_id: string, evts: readonly EvenementHorodate[]) => void historiques.push([...evts]),
  resume: (_r: ResumeSession) => undefined,
};

async function attendre(condition: () => boolean, delaiMs = 3000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!condition() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10));
}

function configDeTest(): ConfigPoste {
  return {
    machine: 'tour',
    relais: 'ws://127.0.0.1:1/poste',
    secret: 'secret-factice',
    description: 'banc de test',
    racines: [],
    comptes: { principal: dossier },
    distants: [],
    donnees: join(dossier, 'donnees'),
    fenetreContexte: 1_000_000,
  };
}

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-gest-distant-'));
  mkdirSync(join(dossier, 'donnees'), { recursive: true });
  writeFileSync(
    join(dossier, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: JETON, expiresAt: Date.now() + 3_600_000 } }),
  );
  writeFileSync(join(dossier, 'poste.json'), JSON.stringify({ machine: 'tour', comptes: { principal: dossier } }));
  process.env['CCREMOTE_CONFIG_POSTE'] = join(dossier, 'poste.json');
  journal = pino({ enabled: false });
  evenements = [];
  historiques = [];
  gestionnaire = new GestionnaireSessions(configDeTest(), sortie, join(dossier, 'poste.sock'), journal);
  api.sessions = [sessionApi(ID)];
  // Le fil est servi du plus récent au plus ancien, comme l'API.
  api.fils.set(ID, [...[...tourApi(1, 'Un'), ...tourApi(2, 'Deux')]].reverse());
});

afterEach(() => {
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  delete process.env['CCREMOTE_CONFIG_POSTE'];
  rmSync(dossier, { recursive: true, force: true });
});

/** Active le suivi du compte et attend que la session apparaisse dans le gestionnaire. */
async function suivreLeCompte(): Promise<void> {
  expect(gestionnaire.basculerDistant('principal', true)).toEqual({ ok: true });
  await attendre(() => gestionnaire.lister().some((r) => r.id === ID));
}

describe('session Remote Control suivie, vue du gestionnaire', () => {
  test('trace de relais : émise dans le fil et gardée sur le poste', async () => {
    await suivreLeCompte();
    const r = await gestionnaire.executer({
      kind: 'tracer_relais',
      id: 'c1',
      sessionId: ID,
      sens: 'sortant',
      autre: { session: 'sess_B', titre: 'Cible', compte: 'principal' },
      texte: 'Bonjour',
    });
    expect(r).toEqual({ ok: true });
    expect(evenements).toContainEqual({
      type: 'relais',
      sens: 'sortant',
      session: 'sess_B',
      titre: 'Cible',
      compte: 'principal',
      texte: 'Bonjour',
    });
    expect(readFileSync(join(dossier, 'donnees', 'relais', `${ID}.jsonl`), 'utf8')).toContain('Bonjour');
  });

  test('trace pour une session inconnue : refusée, rien n’est écrit', async () => {
    const r = await gestionnaire.executer({
      kind: 'tracer_relais',
      id: 'c2',
      sessionId: 'inconnue',
      sens: 'entrant',
      autre: { session: 'sess_B', titre: 'Cible', compte: 'principal' },
      texte: 'x',
    });
    expect(r).toMatchObject({ ok: false });
  });

  test('envoi : POST à claude.ai ; commandes non prises en charge : refus clair ; supprimer : refusé', async () => {
    await suivreLeCompte();
    expect(await gestionnaire.executer({ kind: 'envoyer', id: 'c3', sessionId: ID, texte: 'Salut' })).toEqual({
      ok: true,
      donnees: expect.any(Object),
    });
    expect(api.posts).toHaveLength(1);
    const compacter = await gestionnaire.executer({ kind: 'compacter', id: 'c4', sessionId: ID });
    expect(compacter).toMatchObject({ ok: false, erreur: 'pilotage claude.ai : pas encore pris en charge' });
    const supprimer = await gestionnaire.supprimer(ID);
    expect(supprimer).toMatchObject({ ok: false });
    expect(api.posts).toHaveLength(1);
  });

  test('historique : la trace reprend sa place entre les événements du transcript', async () => {
    await suivreLeCompte();
    const avant = historiques.length;
    await gestionnaire.executer({
      kind: 'tracer_relais',
      id: 'c5',
      sessionId: ID,
      sens: 'entrant',
      autre: { session: 'sess_C', titre: 'Source', compte: 'principal' },
      texte: 'au milieu',
    });
    const r = await gestionnaire.executer({ kind: 'historique', id: 'c6', sessionId: ID });
    expect(r.ok).toBe(true);
    const dernierLot = historiques.at(-1) ?? [];
    expect(historiques.length).toBeGreaterThan(avant);
    // La trace est datée de maintenant : sa place dépend de l'horloge, l'ordre du transcript non.
    expect(dernierLot.filter((h) => h.evt.type !== 'relais').map((h) => h.evt.type)).toEqual([
      'texte',
      'tour_fini',
      'texte',
      'tour_fini',
    ]);
    expect(dernierLot.filter((h) => h.evt.type === 'relais')).toHaveLength(1);
  });
});

describe('session suivie : rien n’est écrit sur disque', () => {
  test('la liste inclut la session suivie ; le dossier de données reste vide', async () => {
    await suivreLeCompte();
    expect(gestionnaire.lister().map((r) => r.moteur)).toEqual(['claude_ai']);
    expect(readdirSync(join(dossier, 'donnees'))).toEqual([]);
  });
});
