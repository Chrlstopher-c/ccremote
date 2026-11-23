// Responsabilité : tests du service de dictée côté relais — agrégat du parc (ordre du parc, poste hors ligne, poste
// muet ou illisible), pairs ajoutés et `local=1`, pilotage par machine (404, 400, 409, relais de l'action),
// choix de la machine nommée pour la transcription, et transcription relayée au pair qui tient la machine.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ApiDictee } from './api-dictee.ts';

const JOURNAL = { warn: () => undefined, error: () => undefined, info: () => undefined } as unknown as Logger;

const SANS_PAIRS = {
  dicteeServiceDesPairs: async () => [],
  membreDeMachine: () => null,
  transcrireChez: async () => new Response('{}'),
};
type Commande = Parameters<Postes['commander']>[1];
type Requete = Request & { params: Record<string, string> };
type Reponder = (machine: string, commande: Commande) => ReponsePoste | Promise<ReponsePoste>;

const JAMAIS = new Promise<ReponsePoste>(() => undefined);

const ETAT_SERVICE = {
  installe: true,
  etat: 'pret',
  depuis: '2026-11-20T10:00:00.000Z',
  chargementMs: 1200,
  memoireGpuMo: 4096,
  latenceMs: 850,
  derniereActivite: '2026-11-20T10:05:00.000Z',
  arretInactiviteMin: 15,
  lanceParPoste: true,
  message: null,
};

function postesFaux(machines: readonly { id: string; enLigne: boolean }[], reponder: Reponder) {
  const appels: { machine: string; commande: Commande }[] = [];
  const postes = {
    vues: () => machines.map((m) => ({ id: m.id, enLigne: m.enLigne })),
    commander: async (machine: string, commande: Commande) => {
      appels.push({ machine, commande });
      return reponder(machine, commande);
    },
  } as unknown as Pick<Postes, 'vues' | 'commander'>;
  return { postes, appels };
}

function requete(url: string, params: Record<string, string>, corps?: unknown, methode = 'GET'): Requete {
  const init: RequestInit = { method: methode };
  if (corps !== undefined) init.body = JSON.stringify(corps);
  return Object.assign(new Request(`http://relais.test${url}`, init), { params });
}

describe('état du service (parc)', () => {
  test('ordre du parc ; hors ligne et muet listés absents avec leur raison', async () => {
    const f = postesFaux(
      [
        { id: 'tour', enLigne: true },
        { id: 'portable', enLigne: false },
        { id: 'pi', enLigne: true },
      ],
      (machine) => (machine === 'tour' ? { ok: true, donnees: ETAT_SERVICE } : JAMAIS),
    );
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: SANS_PAIRS, delaiEtatMs: 20 });
    const corps = (await (await api.service(requete('/api/dictee/service', {}))).json()) as {
      machines: Record<string, unknown>[];
    };
    expect(corps.machines.map((m) => m['machine'])).toEqual(['tour', 'portable', 'pi']);
    expect(corps.machines[0]).toEqual({ machine: 'tour', ...ETAT_SERVICE });
    expect(corps.machines[1]).toEqual({
      machine: 'portable',
      installe: false,
      etat: 'absent',
      depuis: null,
      chargementMs: null,
      memoireGpuMo: null,
      latenceMs: null,
      derniereActivite: null,
      arretInactiviteMin: 0,
      lanceParPoste: false,
      message: 'poste hors ligne',
    });
    expect(corps.machines[2]).toMatchObject({ machine: 'pi', installe: false, message: 'poste sans réponse' });
    expect(f.appels.some((a) => a.machine === 'portable')).toBe(false);
  });

  test('réponse illisible d’un poste : absent, sans erreur brute', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: { sansRapport: true } }));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: SANS_PAIRS });
    const corps = (await (await api.service(requete('/api/dictee/service', {}))).json()) as {
      machines: { message: string }[];
    };
    expect(corps.machines[0]?.message).toBe('poste sans réponse');
  });
});

describe('pilotage d’une machine', () => {
  test('machine inconnue : 404 ; réglage sans durée : 400', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_SERVICE }));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: SANS_PAIRS });
    expect((await api.piloter(requete('/x', { id: 'ailleurs' }, { action: 'demarrer' }, 'POST'))).status).toBe(404);
    expect((await api.piloter(requete('/x', { id: 'tour' }, { action: 'regler' }, 'POST'))).status).toBe(400);
    expect(f.appels.length).toBe(0);
  });

  test('poste hors ligne : 409 avec la raison du poste', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: false }], () => ({ ok: false, erreur: 'tour est hors ligne' }));
    const r = await new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: SANS_PAIRS }).piloter(
      requete('/x', { id: 'tour' }, { action: 'arreter' }, 'POST'),
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'tour est hors ligne' });
  });

  test('action relayée telle quelle ; état relu rendu avec la machine', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_SERVICE }));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: SANS_PAIRS });
    const r = await api.piloter(requete('/x', { id: 'tour' }, { action: 'demarrer' }, 'POST'));
    expect(await r.json()).toEqual({ machine: 'tour', ...ETAT_SERVICE });
    expect(f.appels[0]).toEqual({ machine: 'tour', commande: { kind: 'dictee_service', action: 'demarrer' } });
    await api.piloter(requete('/x', { id: 'tour' }, { action: 'regler', arretInactiviteMin: 30 }, 'POST'));
    expect(f.appels[1]?.commande).toEqual({ kind: 'dictee_service', action: 'regler', arretInactiviteMin: 30 });
  });
});

describe('choix de la machine pour la transcription', () => {
  const dispo = (machine: string, disponible: boolean) => ({ ok: true, donnees: { disponible, raison: null } });
  const transcrit = (_m: string, c: Commande): ReponsePoste =>
    c.kind === 'dictee_etat' ? dispo('', true) : { ok: true, donnees: { etat: 'ok', texte: 'bonjour', ms: 12 } };

  test('la machine nommée transcrit si elle a le service', async () => {
    const f = postesFaux(
      [
        { id: 'tour', enLigne: true },
        { id: 'portable', enLigne: true },
      ],
      transcrit,
    );
    const r = await new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: SANS_PAIRS }).transcrire(
      requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'portable' }, 'POST'),
    );
    expect(await r.json()).toEqual({ etat: 'ok', texte: 'bonjour', ms: 12, machine: 'portable' });
    expect(f.appels.at(-1)?.machine).toBe('portable');
  });

  test('machine nommée sans le service, ou inconnue : premier poste qui l’a', async () => {
    const f = postesFaux(
      [
        { id: 'tour', enLigne: true },
        { id: 'portable', enLigne: true },
      ],
      (machine, c) => (c.kind === 'dictee_etat' ? dispo(machine, machine === 'tour') : transcrit(machine, c)),
    );
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: SANS_PAIRS });
    const sansService = await api.transcrire(
      requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'portable' }, 'POST'),
    );
    expect(await sansService.json()).toMatchObject({ machine: 'tour' });
    const inconnue = await api.transcrire(requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'ailleurs' }, 'POST'));
    expect(await inconnue.json()).toMatchObject({ machine: 'tour' });
  });
});

describe('service avec les pairs', () => {
  const PAIR = { machine: 'serveur', ...ETAT_SERVICE };
  const noms = (corps: unknown): unknown[] =>
    (corps as { machines: Record<string, unknown>[] }).machines.map((m) => m['machine']);

  test('pairs en ligne ajoutés après le parc ; local=1 : les pairs jamais interrogés', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_SERVICE }));
    let appels = 0;
    const pairs = {
      ...SANS_PAIRS,
      dicteeServiceDesPairs: async () => {
        appels += 1;
        return [PAIR];
      },
    };
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs });
    expect(noms(await (await api.service(requete('/api/dictee/service', {}))).json())).toEqual(['tour', 'serveur']);
    expect(noms(await (await api.service(requete('/api/dictee/service?local=1', {}))).json())).toEqual(['tour']);
    expect(appels).toBe(1);
  });

  test('entrée de pair illisible : ignorée, la liste reste', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_SERVICE }));
    const pairs = { ...SANS_PAIRS, dicteeServiceDesPairs: async () => [{ sansMachine: true }, 42, PAIR] };
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs });
    expect(noms(await (await api.service(requete('/api/dictee/service', {}))).json())).toEqual(['tour', 'serveur']);
  });
});

describe('transcription sur la machine d’un pair', () => {
  const transcriptionLocale = (_m: string, c: Commande): ReponsePoste =>
    c.kind === 'dictee_etat'
      ? { ok: true, donnees: { disponible: true, raison: null } }
      : { ok: true, donnees: { etat: 'ok', texte: 'local', ms: 3 } };

  function pairsRelais(membre: string | null, reponse: () => Response) {
    const relayes: { membre: string; corps: string }[] = [];
    const pairs = {
      ...SANS_PAIRS,
      membreDeMachine: (machine: string) => (machine === 'serveur' ? membre : null),
      transcrireChez: async (m: string, corps: string) => {
        relayes.push({ membre: m, corps });
        return reponse();
      },
    };
    return { pairs, relayes };
  }

  test('machine d’un pair : relayée telle quelle, sans poste local sollicité', async () => {
    const f = postesFaux([{ id: 'portable', enLigne: true }], transcriptionLocale);
    const rendu = { etat: 'ok', texte: 'bonjour', ms: 9, machine: 'serveur' };
    const p = pairsRelais('membre-serveur', () => Response.json(rendu));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: p.pairs });
    const r = await api.transcrire(requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'serveur' }, 'POST'));
    expect(await r.json()).toEqual({ etat: 'ok', texte: 'bonjour', ms: 9, machine: 'serveur' });
    expect(p.relayes).toEqual([{ membre: 'membre-serveur', corps: '{"pcm16":"AAAA","machine":"serveur"}' }]);
    expect(f.appels.some((a) => a.commande.kind === 'dictee_transcrire')).toBe(false);
  });

  test('requête déjà relayée (local=1) : jamais relayée une seconde fois, le poste local transcrit', async () => {
    const f = postesFaux([{ id: 'portable', enLigne: true }], transcriptionLocale);
    const p = pairsRelais('membre-serveur', () => Response.json({}));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: p.pairs });
    const r = await api.transcrire(requete('/api/dictee?local=1', {}, { pcm16: 'AAAA', machine: 'serveur' }, 'POST'));
    expect(p.relayes).toEqual([]);
    expect(await r.json()).toMatchObject({ etat: 'ok', machine: 'portable' });
  });

  test('machine de ce poste : jamais relayée, même si un pair prétend la tenir', async () => {
    const f = postesFaux([{ id: 'portable', enLigne: true }], transcriptionLocale);
    const relayes: string[] = [];
    const pairs = {
      ...SANS_PAIRS,
      membreDeMachine: () => 'membre-x',
      transcrireChez: async () => {
        relayes.push('relayee');
        return Response.json({});
      },
    };
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs });
    await api.transcrire(requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'portable' }, 'POST'));
    expect(relayes).toEqual([]);
  });

  test('pair injoignable : erreur lisible, aucune transcription locale', async () => {
    const f = postesFaux([{ id: 'portable', enLigne: true }], transcriptionLocale);
    const p = pairsRelais('membre-serveur', () => new Response('{"erreur":"hors ligne"}', { status: 409 }));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, pairs: p.pairs });
    const r = await api.transcrire(requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'serveur' }, 'POST'));
    expect(await r.json()).toEqual({ etat: 'erreur', raison: 'machine du pair injoignable' });
    expect(f.appels.some((a) => a.commande.kind === 'dictee_transcrire')).toBe(false);
  });
});
