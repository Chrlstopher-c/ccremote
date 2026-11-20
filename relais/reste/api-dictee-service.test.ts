// Responsabilité : tests du service de dictée côté relais — agrégat du parc (ordre du parc, poste hors ligne, poste
// muet ou illisible), pilotage par machine (404, 400, 409, relais de l'action), et choix de la machine nommée pour la
// transcription. Postes simulés : aucune machine contactée.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ApiDictee } from './api-dictee.ts';

const JOURNAL = { warn: () => undefined, error: () => undefined, info: () => undefined } as unknown as Logger;
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
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL, delaiEtatMs: 20 });
    const corps = (await (await api.service()).json()) as { machines: Record<string, unknown>[] };
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
    const corps = (await (await new ApiDictee({ postes: f.postes, journal: JOURNAL }).service()).json()) as {
      machines: { message: string }[];
    };
    expect(corps.machines[0]?.message).toBe('poste sans réponse');
  });
});

describe('pilotage d’une machine', () => {
  test('machine inconnue : 404 ; réglage sans durée : 400', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_SERVICE }));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL });
    expect((await api.piloter(requete('/x', { id: 'ailleurs' }, { action: 'demarrer' }, 'POST'))).status).toBe(404);
    expect((await api.piloter(requete('/x', { id: 'tour' }, { action: 'regler' }, 'POST'))).status).toBe(400);
    expect(f.appels.length).toBe(0);
  });

  test('poste hors ligne : 409 avec la raison du poste', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: false }], () => ({ ok: false, erreur: 'tour est hors ligne' }));
    const r = await new ApiDictee({ postes: f.postes, journal: JOURNAL }).piloter(
      requete('/x', { id: 'tour' }, { action: 'arreter' }, 'POST'),
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'tour est hors ligne' });
  });

  test('action relayée telle quelle ; état relu rendu avec la machine', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_SERVICE }));
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL });
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
    const r = await new ApiDictee({ postes: f.postes, journal: JOURNAL }).transcrire(
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
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL });
    const sansService = await api.transcrire(
      requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'portable' }, 'POST'),
    );
    expect(await sansService.json()).toMatchObject({ machine: 'tour' });
    const inconnue = await api.transcrire(requete('/api/dictee', {}, { pcm16: 'AAAA', machine: 'ailleurs' }, 'POST'));
    expect(await inconnue.json()).toMatchObject({ machine: 'tour' });
  });
});
