// Responsabilité : tests du service de voix côté relais — agrégat du parc (ordre du parc, poste hors ligne ou muet,
// pairs en ligne, entrées de pair illisibles ignorées), `local=1` (les postes locaux seuls, pairs jamais interrogés),
// pilotage (404 machine inconnue, 400 corps invalide, relais de l'action, refus du poste). Postes simulés.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ApiServiceVoix } from './api-voix-service.ts';

const JOURNAL = { warn: () => undefined, error: () => undefined, info: () => undefined } as unknown as Logger;
type Commande = Parameters<Postes['commander']>[1];
type Requete = Request & { params: Record<string, string> };

const JAMAIS = new Promise<ReponsePoste>(() => undefined);
const ETAT_PRET = { installe: true, etat: 'pret', depuis: '2026-11-20T10:00:00.000Z', message: null };

function postesFaux(
  machines: readonly { id: string; enLigne: boolean }[],
  reponder: (machine: string, commande: Commande) => ReponsePoste | Promise<ReponsePoste>,
) {
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

function pairsFaux(entrees: unknown[]) {
  let appels = 0;
  return {
    pairs: {
      voixServiceDesPairs: async () => {
        appels += 1;
        return entrees;
      },
    },
    appels: () => appels,
  };
}

function requete(url: string, params: Record<string, string>, corps?: unknown, methode = 'GET'): Requete {
  const init: RequestInit = { method: methode };
  if (corps !== undefined) init.body = JSON.stringify(corps);
  return Object.assign(new Request(`http://relais.test${url}`, init), { params });
}

describe('état du service de voix (parc et pairs)', () => {
  test('ordre du parc ; hors ligne et muet absents avec leur raison ; pairs ajoutés après', async () => {
    const f = postesFaux(
      [
        { id: 'tour', enLigne: true },
        { id: 'portable', enLigne: false },
        { id: 'pi', enLigne: true },
      ],
      (machine) => (machine === 'tour' ? { ok: true, donnees: ETAT_PRET } : JAMAIS),
    );
    const pairs = pairsFaux([{ machine: 'serveur', ...ETAT_PRET }]);
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairs.pairs, journal: JOURNAL, delaiEtatMs: 20 });
    const corps = (await (await api.service(requete('/api/voix/service', {}))).json()) as {
      machines: Record<string, unknown>[];
    };
    expect(corps.machines.map((m) => m['machine'])).toEqual(['tour', 'portable', 'pi', 'serveur']);
    expect(corps.machines[0]).toEqual({ machine: 'tour', ...ETAT_PRET });
    expect(corps.machines[1]).toEqual({
      machine: 'portable',
      installe: false,
      etat: 'absent',
      depuis: null,
      message: 'poste hors ligne',
    });
    expect(corps.machines[2]).toMatchObject({ machine: 'pi', installe: false, message: 'poste sans réponse' });
    expect(f.appels.some((a) => a.machine === 'portable')).toBe(false);
    expect(pairs.appels()).toBe(1);
  });

  test('entrées de pair qui ne respectent pas la forme : ignorées sans faire échouer la liste', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_PRET }));
    const pairs = pairsFaux([{ sansMachine: true }, 42, { machine: 'serveur', ...ETAT_PRET }]);
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairs.pairs, journal: JOURNAL });
    const corps = (await (await api.service(requete('/api/voix/service', {}))).json()) as {
      machines: Record<string, unknown>[];
    };
    expect(corps.machines.map((m) => m['machine'])).toEqual(['tour', 'serveur']);
  });

  test('réponse illisible d’un poste : absent, sans erreur brute', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: { sansRapport: true } }));
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairsFaux([]).pairs, journal: JOURNAL });
    const corps = (await (await api.service(requete('/api/voix/service', {}))).json()) as {
      machines: Record<string, unknown>[];
    };
    expect(corps.machines[0]).toMatchObject({ machine: 'tour', installe: false, message: 'poste sans réponse' });
  });

  test('local=1 : les postes locaux seuls, les pairs jamais interrogés', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_PRET }));
    const pairs = pairsFaux([{ machine: 'serveur', ...ETAT_PRET }]);
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairs.pairs, journal: JOURNAL });
    const local = await api.service(new Request('http://relais.test/api/voix/service?local=1'));
    const lu = (await local.json()) as { machines: Record<string, unknown>[] };
    expect(lu.machines.map((m) => m['machine'])).toEqual(['tour']);
    expect(pairs.appels()).toBe(0);
  });
});

describe('pilotage du service de voix', () => {
  test('machine inconnue : 404', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_PRET }));
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairsFaux([]).pairs, journal: JOURNAL });
    const r = await api.piloter(requete('/api/machines/x/voix', { id: 'x' }, { action: 'demarrer' }, 'POST'));
    expect(r.status).toBe(404);
    expect(f.appels.length).toBe(0);
  });

  test('action invalide : 400, aucune commande envoyée', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_PRET }));
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairsFaux([]).pairs, journal: JOURNAL });
    const r = await api.piloter(requete('/api/machines/tour/voix', { id: 'tour' }, { action: 'casser' }, 'POST'));
    expect(r.status).toBe(400);
    expect(f.appels.length).toBe(0);
  });

  test('démarrer : relayé au poste, état relu rendu avec la machine', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: ETAT_PRET }));
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairsFaux([]).pairs, journal: JOURNAL });
    const r = await api.piloter(requete('/api/machines/tour/voix', { id: 'tour' }, { action: 'demarrer' }, 'POST'));
    expect(f.appels).toEqual([{ machine: 'tour', commande: { kind: 'voix_service', action: 'demarrer' } }]);
    expect(await r.json()).toEqual({ machine: 'tour', ...ETAT_PRET });
  });

  test('refus du poste : 409 avec sa raison', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: false, erreur: 'non installé' }));
    const api = new ApiServiceVoix({ postes: f.postes, pairs: pairsFaux([]).pairs, journal: JOURNAL });
    const r = await api.piloter(requete('/api/machines/tour/voix', { id: 'tour' }, { action: 'arreter' }, 'POST'));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'non installé' });
  });
});
