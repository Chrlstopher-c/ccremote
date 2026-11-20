// Responsabilité : tests de la façade de l'entretien du relais — gestes relayés au bon poste, machine hors ligne, port
// distant non pris (aucune liaison touchée), réveil inconnu. Postes et machines simulés : aucune machine contactée.
import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { VueMachine } from '../../commun/api-clients.ts';
import type { ProcessusPoste } from '../../commun/entretien.ts';
import type { Postes } from '../parc/postes.ts';
import { ApiEntretien, type DependancesEntretien } from './api-entretien.ts';
import { ReseauxConnus } from './reseaux.ts';
import { Reveil } from './reveil.ts';

const JOURNAL = { warn: () => undefined, info: () => undefined } as unknown as Logger;
type Commande = Parameters<Postes['commander']>[1];

function vue(id: string, enLigne: boolean): VueMachine {
  return {
    id,
    description: id,
    racines: [],
    projets: [],
    comptes: [],
    etatComptes: [],
    version: '2.0.0',
    etat: null,
    derniereVue: '2026-11-20T10:00:00.000Z',
    enLigne,
  };
}

interface Options {
  readonly reponse?: unknown;
  readonly tunnelDetail?: string | null;
}

function postesSimules(
  envoyes: { id: string; commande: Commande }[],
  options: Options,
): DependancesEntretien['postes'] {
  return {
    vues: () => [vue('tour', true), vue('portable', false)],
    enLigne: (id) => id === 'tour',
    commander: async (id, commande) => {
      envoyes.push({ id, commande });
      return { ok: true, donnees: options.reponse ?? { ok: true, phrase: 'Processus arrêté' } };
    },
    infosPoste: () => null,
  };
}

function monter(options: Options = {}) {
  const envoyes: { id: string; commande: Commande }[] = [];
  const reseaux = new ReseauxConnus(join(tmpdir(), `entretien-api-${Math.random()}`, 'reveil.json'), JOURNAL);
  const d: DependancesEntretien = {
    postes: postesSimules(envoyes, options),
    machines: { empreinteAttendue: async () => 'EMP' },
    registre: {
      lire: (id) => (id === 'tour' ? { hote: 'h', port: 22, utilisateur: 'u', cle: '/k', portDistant: 47321 } : null),
    },
    ssh: { executer: async () => ({ code: 1, sortie: '', erreurs: '', delaiDepasse: false }) },
    tunnels: {
      etat: () => ({ ouvert: false, detail: options.tunnelDetail ?? null }),
      relancer: () => undefined,
      pids: () => [{ id: 'tour', pid: 777 }],
    },
    reveil: new Reveil({
      wol: new Map(),
      diffusionWol: '255.255.255.255',
      reseaux,
      envoyerPar: async () => ({ ok: true }),
      factice: undefined,
      journal: JOURNAL,
    }),
    locale: 'tour',
    relais: { version: '2.0.0', commit: 'abc' },
    journal: JOURNAL,
  };
  return { api: new ApiEntretien(d), envoyes };
}

const requete = (corps: unknown, params: Record<string, string> = {}): Request & { params: Record<string, string> } =>
  Object.assign(new Request('http://relais.local/x', { method: 'POST', body: JSON.stringify(corps) }), { params });

describe('façade de l’entretien', () => {
  test('état : version du relais et machines, la locale sans comparaison de version', async () => {
    const { api } = monter();
    const corps = (await (await api.etat()).json()) as {
      relais: { version: string };
      machines: { id: string; locale: boolean }[];
    };
    expect(corps.relais.version).toBe('2.0.0');
    expect(corps.machines.map((m) => [m.id, m.locale])).toEqual([
      ['tour', true],
      ['portable', false],
    ]);
  });

  test('processus : tunnel du poste local nommé d’après sa machine ; hors ligne signalé', async () => {
    const processus: ProcessusPoste = {
      pid: 777,
      debut: '1',
      ppid: 1,
      commande: 'Tunnel SSH',
      role: 'tunnel',
      session: null,
      depuis: '',
      memoire: 0,
      reste: false,
    };
    const { api } = monter({ reponse: { processus: [processus], tmux: [] } });
    const corps = (await (await api.processus()).json()) as {
      machines: { id?: string; machine: string; joignable: boolean; processus: ProcessusPoste[] }[];
    };
    const tour = corps.machines.find((m) => m.machine === 'tour');
    expect(tour?.processus[0]?.commande).toBe('Tunnel SSH vers tour');
    expect(corps.machines.find((m) => m.machine === 'portable')).toMatchObject({ joignable: false, processus: [] });
  });

  test('arrêt d’un processus : relayé au poste, PID et heure de démarrage transmis', async () => {
    const { api, envoyes } = monter();
    const r = await api.arreterProcessus(requete({ machine: 'tour', pid: 4242, debut: '99', force: false }));
    expect(await r.json()).toEqual({ ok: true, phrase: 'Processus arrêté' });
    expect(envoyes).toEqual([
      { id: 'tour', commande: { kind: 'processus_arreter', pid: 4242, debut: '99', force: false } },
    ]);
  });

  test('arrêt : PID de plate-forme refusé avant tout envoi ; machine hors ligne : phrase, rien envoyé', async () => {
    const { api, envoyes } = monter();
    expect((await api.arreterProcessus(requete({ machine: 'tour', pid: 1, debut: '9' }))).status).toBe(400);
    const horsLigne = await (await api.arreterTmux(requete({ machine: 'portable', nom: 'claude-x' }))).json();
    expect(horsLigne).toEqual({ ok: false, phrase: 'portable est hors ligne' });
    expect(envoyes).toEqual([]);
  });

  test('liaison : sans port distant pris, rien n’est interrogé ni libéré', async () => {
    const { api, envoyes } = monter({ tunnelDetail: 'délai dépassé' });
    expect(await (await api.occupant('tour')).json()).toEqual({ occupe: false, pid: null, depuis: null });
    const liberee = await (await api.liberer(requete({ pid: 4242 }, { id: 'tour' }))).json();
    expect(liberee).toEqual({ ok: false, phrase: 'Le processus qui tient la liaison a changé ou n’existe plus' });
    expect(envoyes).toEqual([]);
  });

  test('réveil d’une machine sans MAC connue : 404', async () => {
    const { api } = monter();
    expect((await api.reveiller('inconnue')).status).toBe(404);
  });
});
