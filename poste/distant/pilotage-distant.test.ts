import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Logger } from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { EvenementHorodate } from '../session/historique.ts';
import type { ModeleDate } from '../../commun/modele-date.ts';
import type { SortieSession } from '../session/session-poste.ts';
import { demarrerFauxApi, type FauxApi, evenementApi, sessionApi, tourApi } from './faux-claude-ai.ts';
import { type SessionBrute, lireSession } from './donnees.ts';
import { PAS_ENCORE_CLAUDE_AI, SessionDistante } from './session-distante.ts';

// Pilotage d'une session claude.ai contre le faux serveur : corps exacts des POST, dialogues, erreurs. Aucun appel
// réel.
const JETON = 'jeton-factice-pilotage-ne-pas-utiliser';
const ID = 'cse_pilote';

let api: FauxApi;
let dossier: string;
let lignes: string[];
let journal: Logger;
let evenements: Evenement[];
let publications: number;
let horloge: number;

function bruteDe(surcharge: Record<string, unknown> = {}): SessionBrute {
  const s = lireSession(
    sessionApi(ID, { last_event_at: `2026-11-20T11:${String(horloge).padStart(2, '0')}:00.000Z`, ...surcharge }),
  );
  if (!s) throw new Error('session de test invalide');
  return s;
}

function creer(): SessionDistante {
  const sortie: SortieSession = {
    evenement: (_id: string, evt: Evenement) => void evenements.push(evt),
    historique: (_id: string, _evts: readonly EvenementHorodate[]) => undefined,
    resume: (_r: ResumeSession) => undefined,
  };
  const contexte = { machine: 'tour', compte: 'principal', fenetreContexte: 1_000_000 };
  return new SessionDistante(
    { contexte, configDir: dossier, journal, sortie, publier: () => (publications += 1) },
    bruteDe(),
  );
}

/** Le fil (chronologique) apparaît dans claude.ai : on le sert et on laisse la session le lire. */
async function fil(s: SessionDistante, chronologique: unknown[]): Promise<void> {
  horloge += 1;
  api.fils.set(ID, [...chronologique].reverse());
  await s.synchroniser(bruteDe());
}

const demandeOutil = (requestId: string, outil: string, entree: Record<string, unknown>): Record<string, unknown> =>
  evenementApi(
    `ctl-${requestId}`,
    {
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'can_use_tool', tool_name: outil, input: entree, permission_suggestions: [] },
    },
    '2026-11-20T11:00:00.000Z',
  );

const demandeQuestion = (requestId: string): Record<string, unknown> =>
  demandeOutil(requestId, 'AskUserQuestion', {
    questions: [
      {
        question: 'Quelle couleur ?',
        options: [
          { label: 'Rouge', description: 'chaud' },
          { label: 'Bleu', description: 'froid' },
        ],
        multiSelect: false,
      },
    ],
  });

const corpsPost = (indice = -1): { events: Record<string, unknown>[] } => {
  const p = api.posts.at(indice);
  if (!p) throw new Error('aucun POST');
  // Forme du CLI : chaque événement voyage dans une enveloppe `payload`.
  const corps = p.corps as { events: { payload: Record<string, unknown> }[] };
  expect(corps.events.every((e) => typeof e.payload === 'object')).toBe(true);
  return { events: corps.events.map((e) => e.payload) };
};

beforeEach(() => {
  api = demarrerFauxApi();
  process.env['CCREMOTE_API_CLAUDE_AI'] = api.url;
  dossier = mkdtempSync(join(tmpdir(), 'quart-pilotage-'));
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    join(dossier, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: JETON, expiresAt: Date.now() + 3_600_000 } }),
  );
  lignes = [];
  journal = pino({ level: 'trace' }, { write: (l: string) => void lignes.push(l) });
  evenements = [];
  publications = 0;
  horloge = 0;
});

afterEach(() => {
  api.arreter();
  delete process.env['CCREMOTE_API_CLAUDE_AI'];
  rmSync(dossier, { recursive: true, force: true });
});

describe('envoi de messages et d’interruption', () => {
  test('envoyer : POST d’un message utilisateur au corps exact', async () => {
    const s = creer();
    expect(await s.envoyer('Bonjour')).toBeNull();
    expect(api.chemins.at(-1)).toBe(`/v1/code/sessions/${ID}/events`);
    const [evt] = corpsPost().events;
    expect(evt).toMatchObject({
      session_id: ID,
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content: 'Bonjour' },
    });
    expect(typeof evt?.['uuid']).toBe('string');
  });

  test('envoyer avec une image : blocs image puis texte dans le message', async () => {
    const s = creer();
    expect(await s.envoyer('Voir', [{ nom: 'a.png', mime: 'image/png', base64: 'AAAA' }])).toBeNull();
    const [evt] = corpsPost().events;
    expect(evt).toMatchObject({
      type: 'user',
      message: {
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'Voir' },
        ],
      },
    });
  });

  test('envoyer avec une pièce qui n’est pas une image : refus clair, aucun POST', async () => {
    const s = creer();
    const r = await s.envoyer('Voir', [{ nom: 'a.pdf', mime: 'application/pdf', base64: 'AAAA' }]);
    expect(r).toBe('à distance, seules les images peuvent être jointes');
    expect(api.posts).toHaveLength(0);
  });

  test('interrompre : control_request interrupt au corps exact', async () => {
    const s = creer();
    expect(await s.interrompre()).toBeNull();
    const [evt] = corpsPost().events;
    expect(evt).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } });
    expect(String(evt?.['request_id'])).toMatch(/^interrupt-/);
  });
});

describe('réglages de session', () => {
  test('modèle : set_model ; mode : set_permission_mode (noms du SDK) ; renommer : rename_session', async () => {
    const s = creer();
    expect(await s.reglerSession({ kind: 'modele', modele: 'claude-opus-x' })).toBeNull();
    expect(corpsPost().events[0]?.['request']).toEqual({ subtype: 'set_model', model: 'claude-opus-x' });
    expect(await s.reglerSession({ kind: 'mode', mode: 'acceptEdits' })).toBeNull();
    expect(corpsPost().events[0]?.['request']).toEqual({ subtype: 'set_permission_mode', mode: 'acceptEdits' });
    expect(await s.reglerSession({ kind: 'renommer', titre: 'Nouveau' })).toBeNull();
    expect(corpsPost().events[0]?.['request']).toEqual({ subtype: 'rename_session', title: 'Nouveau' });
    expect(s.resume.modele).toBe('claude-opus-x');
  });

  test('effort et style : erreur claire, aucun POST', async () => {
    const s = creer();
    expect(await s.reglerSession({ kind: 'effort', effort: 'high' })).toMatch(/non pris en charge à distance/);
    expect(await s.reglerSession({ kind: 'style', style: 'x' })).toMatch(/non pris en charge à distance/);
    expect(api.posts).toHaveLength(0);
  });

  test('les autres commandes restent refusées', async () => {
    const s = creer();
    expect(await s.compacter()).toBe(PAS_ENCORE_CLAUDE_AI);
    expect(api.posts).toHaveLength(0);
  });
});

describe('dialogue de permission', () => {
  test('la demande d’un outil devient le dialogue, statut question', async () => {
    const s = creer();
    await fil(s, [demandeOutil('req-1', 'Bash', { command: 'ls' })]);
    expect(s.resume.statut).toBe('question');
    expect(s.resume.dialogue).toMatchObject({ id: 'req-1:0', permission: { outil: 'Bash', suggestion: false } });
  });

  test('autoriser : control_response allow au corps exact, dialogue effacé', async () => {
    const s = creer();
    await fil(s, [demandeOutil('req-1', 'Bash', { command: 'ls' })]);
    expect(await s.repondre({ id: 'req-1:0', index: 0 })).toBeNull();
    const [evt] = corpsPost().events;
    expect(evt).toMatchObject({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow', updatedInput: { command: 'ls' } },
      },
    });
    expect(s.resume.dialogue).toBeNull();
    expect(s.resume.statut).not.toBe('question');
  });

  test('refuser : control_response deny avec le message de Lanterne', async () => {
    const s = creer();
    await fil(s, [demandeOutil('req-2', 'Bash', { command: 'rm -rf x' })]);
    expect(await s.repondre({ id: 'req-2:0', index: 2 })).toBeNull();
    expect(corpsPost().events[0]).toMatchObject({
      response: { request_id: 'req-2', response: { behavior: 'deny', message: 'Refusé depuis Lanterne' } },
    });
  });

  test('une demande annulée côté claude.ai sort de la file', async () => {
    const s = creer();
    await fil(s, [demandeOutil('req-6', 'Bash', { command: 'ls' })]);
    await fil(s, [
      demandeOutil('req-6', 'Bash', { command: 'ls' }),
      evenementApi('ann-6', { type: 'control_cancel_request', request_id: 'req-6' }, '2026-11-20T11:02:00.000Z'),
    ]);
    expect(s.resume.dialogue).toBeNull();
    expect(s.resume.statut).not.toBe('question');
  });

  test('réponse à une demande périmée : refus sans POST', async () => {
    const s = creer();
    await fil(s, [demandeOutil('req-3', 'Bash', { command: 'ls' })]);
    expect(await s.repondre({ id: 'autre', index: 0 })).toMatch(/périmée/);
    expect(api.posts).toHaveLength(0);
  });

  test('une réponse donnée ailleurs dans le fil efface le dialogue', async () => {
    const s = creer();
    await fil(s, [demandeOutil('req-4', 'Bash', { command: 'ls' })]);
    await fil(s, [
      demandeOutil('req-4', 'Bash', { command: 'ls' }),
      evenementApi(
        'rep-4',
        { type: 'control_response', response: { request_id: 'req-4' } },
        '2026-11-20T11:01:00.000Z',
      ),
    ]);
    expect(s.resume.dialogue).toBeNull();
  });
});

describe('question à choix (AskUserQuestion)', () => {
  test('réponse : answers ajoutées à l’entrée, forme de questions-sdk', async () => {
    const s = creer();
    await fil(s, [demandeQuestion('q-1')]);
    expect(s.resume.dialogue).toMatchObject({ id: 'q-1:0', multiple: false, saisie: 2 });
    expect(s.resume.dialogue?.options.map((o) => o.libelle)).toEqual(['Rouge', 'Bleu', 'Autre (réponse libre)']);
    expect(await s.repondre({ id: 'q-1:0', index: 0 })).toBeNull();
    expect(corpsPost().events[0]).toMatchObject({
      response: {
        request_id: 'q-1',
        response: { behavior: 'allow', updatedInput: { answers: { 'Quelle couleur ?': 'Rouge' } } },
      },
    });
    expect(s.resume.dialogue).toBeNull();
  });
});

describe('erreurs de pilotage', () => {
  test('403 appareil de confiance : erreur explicite et problème affiché, puis effacé au succès', async () => {
    const s = creer();
    await fil(s, [demandeOutil('req-5', 'Bash', { command: 'ls' })]);
    api.reponsePost = { statut: 403, corps: '{"erreur":"this machine is not a trusted device"}' };
    expect(await s.repondre({ id: 'req-5:0', index: 0 })).toBe(
      'Ce compte exige un appareil de confiance pour piloter cette session',
    );
    expect(s.resume.distant?.probleme).toBe('appareil_de_confiance');
    expect(publications).toBeGreaterThan(0);

    api.reponsePost = null;
    expect(await s.envoyer('Encore')).toBeNull();
    expect(s.resume.distant?.probleme).toBeNull();
  });

  test('403 sans lien avec l’appareil : message brut, pas de problème d’appareil', async () => {
    const s = creer();
    api.reponsePost = { statut: 403, corps: '{"erreur":"interdit"}' };
    const r = await s.envoyer('x');
    expect(r).toMatch(/HTTP 403/);
    expect(s.resume.distant?.probleme).toBeNull();
  });

  test('401 : jeton expiré, message explicite', async () => {
    const s = creer();
    api.reponsePost = { statut: 401, corps: '{}' };
    expect(await s.envoyer('x')).toBe('jeton expiré : reconnecte le compte');
  });

  test('le journal ne contient ni le jeton, ni le corps du message, ni les en-têtes', async () => {
    const s = creer();
    api.reponsePost = { statut: 403, corps: '{"erreur":"trusted device"}' };
    await s.envoyer('Message très secret');
    const trace = lignes.join('\n');
    expect(trace).not.toContain(JETON);
    expect(trace).not.toContain('Message très secret');
    expect(trace).not.toContain('Bearer');
    expect(trace).toContain('403');
  });
});

describe('modèle réel d’une session claude.ai', () => {
  const assistant = (modele: string, creeLe: string, id: string): Record<string, unknown> =>
    evenementApi(id, { type: 'assistant', message: { model: modele } }, creeLe);

  test('le modèle du fil l’emporte sur la liste claude.ai (elle ne suit pas un /model fait dans Desktop)', async () => {
    const s = creer();
    await fil(s, [assistant('claude-opus-5-5', '2026-11-20T11:10:00.000Z', 'ev-modele')]);
    expect(s.resume).toMatchObject({ modele: 'claude-opus-5-5', modeleLe: '2026-11-20T11:10:00.000Z' });
    await s.synchroniser(bruteDe({ config: { model: 'claude-fable-5-2' } }));
    expect(s.resume.modele).toBe('claude-opus-5-5');
  });

  test('le message system/init annonce le modèle de la session', async () => {
    const s = creer();
    await fil(s, [
      evenementApi(
        'ev-init',
        { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' },
        '2026-11-20T11:05:00.000Z',
      ),
    ]);
    expect(s.resume.modele).toBe('claude-sonnet-5-5');
  });

  test('un réglage accepté par claude.ai s’affiche tout de suite et tient quand la liste reste périmée', async () => {
    const s = creer();
    expect(await s.reglerSession({ kind: 'modele', modele: 'claude-opus-x' })).toBeNull();
    expect(s.resume.modele).toBe('claude-opus-x');
    await s.synchroniser(bruteDe({ config: { model: 'claude-fable-5-2' } }));
    expect(s.resume.modele).toBe('claude-opus-x');
  });

  test('un réglage refusé par claude.ai ne change pas le modèle affiché', async () => {
    const s = creer();
    const avant = s.resume.modele;
    api.reponsePost = { statut: 500, corps: '{"erreur":"panne"}' };
    expect(await s.reglerSession({ kind: 'modele', modele: 'claude-opus-x' })).not.toBeNull();
    api.reponsePost = null;
    expect(s.resume.modele).toBe(avant);
  });
});

describe('modèle réglé sur une jumelle Remote Control', () => {
  const CONV_JUMELLE = 'c0000000-0000-4000-8000-0000000000bb';

  test('la jumelle transmet le choix avec sa conversation, et seulement s’il est accepté', async () => {
    const choix: { conversation: string; modele: ModeleDate }[] = [];
    const contexte = { machine: 'tour', compte: 'principal', fenetreContexte: 1_000_000 };
    const sortie: SortieSession = {
      evenement: () => undefined,
      historique: () => undefined,
      resume: () => undefined,
    };
    const s = new SessionDistante(
      {
        contexte,
        configDir: dossier,
        journal,
        sortie,
        publier: () => (publications += 1),
        surModele: (conversation, modele) => void choix.push({ conversation, modele }),
      },
      bruteDe(),
    );
    await fil(s, [
      evenementApi(
        'ev-init',
        { type: 'system', subtype: 'init', session_id: CONV_JUMELLE, model: 'claude-fable-5-2' },
        '2026-11-20T11:05:00.000Z',
      ),
    ]);
    expect(await s.reglerSession({ kind: 'modele', modele: 'claude-opus-5-5' })).toBeNull();
    const modele = { modele: 'claude-opus-5-5', le: expect.any(String) };
    expect(choix).toEqual([{ conversation: CONV_JUMELLE, modele }]);
    api.reponsePost = { statut: 500, corps: '{"erreur":"panne"}' };
    expect(await s.reglerSession({ kind: 'modele', modele: 'claude-sonnet-5-5' })).not.toBeNull();
    api.reponsePost = null;
    expect(choix).toHaveLength(1);
  });
});
