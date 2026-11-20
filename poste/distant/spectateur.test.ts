import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Logger } from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import type { SortieSession } from '../session/session-poste.ts';
import type { ConfigPoste } from '../config.ts';
import { demarrerFauxApi, type FauxApi, sessionApi, tourApi } from './faux-claude-ai.ts';
import { Spectateur } from './spectateur.ts';

// Faux serveur claude.ai, faux compte (dossier temporaire), suivi accéléré : tout tourne en local.
const JETON = 'jeton-factice-spectateur-ne-pas-utiliser';
const PERIODE_MS = 15;

let api: FauxApi;
let dossier: string;
let lignes: string[];
let journal: Logger;
let resumes: ResumeSession[];
let evenements: Evenement[];
let historiques: EvenementHorodate[][];
let spectateurs: Spectateur[];

const sortie: SortieSession = {
  evenement: (_id: string, evt: Evenement) => void evenements.push(evt),
  historique: (_id: string, evts: readonly EvenementHorodate[]) => void historiques.push([...evts]),
  resume: (r: ResumeSession) => void resumes.push(r),
};

function configDeTest(distants: string[]): ConfigPoste {
  return {
    machine: 'tour',
    relais: 'ws://127.0.0.1:1/poste',
    secret: 'secret-factice',
    description: 'banc de test',
    racines: [],
    comptes: { principal: dossier },
    distants,
    donnees: dossier,
    fenetreContexte: 1_000_000,
  };
}

function spectateurDe(distants: string[], locale: (id: string) => boolean = () => false): Spectateur {
  const s = new Spectateur({ config: configDeTest(distants), journal, sortie, locale, periodeMs: PERIODE_MS });
  spectateurs.push(s);
  return s;
}

async function attendre(condition: () => boolean, delaiMs = 3000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!condition() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10));
}

/** Dernier résumé publié pour une session : la publication ne reprend que sur changement. */
const dernier = (id: string): ResumeSession | undefined => [...resumes].reverse().find((r) => r.id === id);

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-spectateur-'));
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    join(dossier, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: JETON, expiresAt: Date.now() + 3_600_000 } }),
  );
  writeFileSync(join(dossier, 'poste.json'), JSON.stringify({ machine: 'tour', comptes: { principal: dossier } }));
  process.env['CCREMOTE_CONFIG_POSTE'] = join(dossier, 'poste.json');
  lignes = [];
  journal = pino({ level: 'trace' }, { write: (l: string) => void lignes.push(l) });
  resumes = [];
  evenements = [];
  historiques = [];
  spectateurs = [];
});

afterEach(() => {
  for (const s of spectateurs) s.arreter();
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  delete process.env['CCREMOTE_CONFIG_POSTE'];
  rmSync(dossier, { recursive: true, force: true });
});

describe('sessions Remote Control d’un compte suivi', () => {
  test('seules les sessions bridge et actives sont suivies', async () => {
    api.sessions = [
      sessionApi('cse_ok'),
      sessionApi('cse_archivee', { status: 'archived' }),
      sessionApi('cse_cli', { environment_kind: 'cli' }),
    ];
    const s = spectateurDe(['principal']);
    s.demarrer();
    await attendre(() => s.lister().length > 0);
    expect(s.lister().map((r) => r.id)).toEqual(['cse_ok']);
  });

  test('une session déjà ouverte sur ce poste n’est pas doublée', async () => {
    api.sessions = [sessionApi('cse_local'), sessionApi('cse_distant')];
    const s = spectateurDe(['principal'], (id) => id === 'cse_local');
    s.demarrer();
    await attendre(() => s.lister().length > 0);
    expect(s.lister().map((r) => r.id)).toEqual(['cse_distant']);
  });

  test('le résumé vient de claude.ai : moteur, connexion, Remote Control, statut', async () => {
    api.sessions = [
      sessionApi('cse_t', { worker_status: 'running' }),
      sessionApi('cse_q', { worker_status: 'requires_action' }),
    ];
    const s = spectateurDe(['principal']);
    s.demarrer();
    await attendre(() => s.lister().length === 2);
    const travail = dernier('cse_t');
    expect(travail).toMatchObject({
      moteur: 'claude_ai',
      compte: 'principal',
      machine: 'tour',
      statut: 'travail',
      remoteControl: { actif: true, url: 'https://claude.ai/code/cse_t' },
      distant: { compte: 'principal', idDistant: 'cse_t', connexion: 'connectee', probleme: null },
    });
    expect(dernier('cse_q')?.statut).toBe('question');
  });

  test('une session déconnectée côté claude.ai est fermée', async () => {
    api.sessions = [sessionApi('cse_x', { connection_status: 'disconnected' })];
    const s = spectateurDe(['principal']);
    s.demarrer();
    await attendre(() => s.lister().length > 0);
    expect(dernier('cse_x')).toMatchObject({ statut: 'fermee', distant: { connexion: 'deconnectee' } });
  });

  test('l’historique traduit part en un lot, dans l’ordre, puis le suivi émet chaque nouveauté une fois', async () => {
    api.fils.set('cse_f', [...tourApi(2, 'Deux'), ...tourApi(1, 'Un')]);
    api.sessions = [sessionApi('cse_f')];
    const s = spectateurDe(['principal']);
    s.demarrer();
    await attendre(() => historiques.length > 0);
    const textesHistorique = historiques[0]?.flatMap((h) => (h.evt.type === 'texte' ? [h.evt.texte] : []));
    expect(textesHistorique).toEqual(['Un', 'Deux']);

    api.fils.set('cse_f', [...tourApi(3, 'Trois'), ...tourApi(2, 'Deux'), ...tourApi(1, 'Un')]);
    api.sessions = [sessionApi('cse_f', { last_event_at: '2026-11-20T10:03:00.000Z' })];
    await attendre(() => evenements.some((e) => e.type === 'texte'));
    await new Promise((r) => setTimeout(r, 80));
    const textesDirects = evenements.flatMap((e) => (e.type === 'texte' ? [e.texte] : []));
    expect(textesDirects).toEqual(['Trois']);
  });

  test('401 : la session porte le problème, sans jeton dans les journaux ni les résumés', async () => {
    api.sessions = [sessionApi('cse_401')];
    const s = spectateurDe(['principal']);
    s.demarrer();
    await attendre(() => s.lister().length > 0);
    api.statutForce = 401;
    await attendre(() => (dernier('cse_401')?.distant?.probleme ?? null) !== null);
    expect(dernier('cse_401')?.distant?.probleme).toContain('expiré');
    const toutLog = lignes.join('\n') + JSON.stringify(resumes);
    expect(toutLog).not.toContain(JETON);
    api.statutForce = null;
    await attendre(() => dernier('cse_401')?.distant?.probleme === null);
    expect(dernier('cse_401')?.distant?.probleme).toBeNull();
  });

  test('la configuration du compte suivi est réécrite ; une coupure rend ses sessions fermées', async () => {
    api.sessions = [sessionApi('cse_bascule')];
    const s = spectateurDe([]);
    s.demarrer();
    expect(s.basculer('principal', true)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(join(dossier, 'poste.json'), 'utf8'))).toMatchObject({ distants: ['principal'] });
    await attendre(() => s.lister().length > 0);
    expect(s.basculer('principal', false)).toEqual({ ok: true });
    expect(s.lister()).toEqual([]);
    expect(dernier('cse_bascule')?.statut).toBe('fermee');
  });

  test('basculer un compte inconnu est refusé', () => {
    const s = spectateurDe([]);
    expect(s.basculer('inconnu', true)).toMatchObject({ ok: false });
  });

  test('une session absente de la liste active est retirée et rendue fermée', async () => {
    api.sessions = [sessionApi('cse_a'), sessionApi('cse_b')];
    const s = spectateurDe(['principal']);
    s.demarrer();
    await attendre(() => s.lister().length === 2);
    api.sessions = [sessionApi('cse_a')];
    await attendre(() => s.lister().length === 1);
    expect(s.lister().map((r) => r.id)).toEqual(['cse_a']);
    expect(dernier('cse_b')?.statut).toBe('fermee');
  });
});
