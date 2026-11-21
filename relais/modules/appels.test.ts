// Responsabilité : tests des appels d'outils de modules côté relais — capacités (GET), relais à une appli
// factice, « module absent » ignoré tant qu'une autre appli répond, délai borné, aucune appli, routes HTTP.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import { ManifesteModule } from '../../commun/modules.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { appelerModule, lireCapacites, repondreModule } from './api-appels.ts';
import { AppelsModules, AUCUNE_APPLI, MODULE_ABSENT } from './appels.ts';

const journal = pino({ enabled: false });
const EMPREINTE = 'a'.repeat(64);
const OUTIL = { nom: 'centrer', description: 'Centre la carte', schema: { type: 'object' } };
const INTEGRATION = { id: 'lieux', titre: 'Lieux', description: 'Des lieux', schema: { type: 'object' } };
const MANIFESTE_CARTE: ManifesteModule = {
  id: 'carte',
  nom: 'Carte',
  version: '1.0.0',
  description: 'Test',
  icone: 'map',
  point: 'index.js',
  emplacements: ['panneau'],
  outils: [OUTIL],
  integrations: [INTEGRATION],
};
const MANIFESTE_MINIMAL: ManifesteModule = {
  ...MANIFESTE_CARTE,
  id: 'meteo',
  nom: 'Météo',
  outils: undefined,
  integrations: undefined,
};

type Appel = Extract<MessageClient, { type: 'module_appel' }>;

function montage(delaiMs = 1000): { appels: AppelsModules; diffusion: Diffusion; registre: Registre } {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const diffusion = new Diffusion();
  const module = (manifeste: ManifesteModule) => ({
    kind: 'module' as const,
    id: manifeste.id,
    manifeste,
    fichiers: [],
    empreinte: EMPREINTE,
  });
  registre.modules.enregistrer('tour', module(MANIFESTE_CARTE));
  registre.modules.enregistrer('tour', module(MANIFESTE_MINIMAL));
  registre.modules.enregistrer('tour', { kind: 'module_erreur', id: 'panne', erreur: 'cassé' });
  return { appels: new AppelsModules({ registre, diffusion, delaiMs }), diffusion, registre };
}

/** Une appli factice connectée : ce qu'elle reçoit est rangé dans `recus`. */
function appli(diffusion: Diffusion, recus: MessageClient[]): void {
  const ws = { send: (t: string) => recus.push(JSON.parse(t) as MessageClient) };
  diffusion.ajouter(ws as unknown as ServerWebSocket<unknown>);
}

function appelRecu(recus: MessageClient[]): Appel {
  const trouve = recus.find((m): m is Appel => m.type === 'module_appel');
  if (!trouve) throw new Error('aucun appel diffusé');
  return trouve;
}

/** Le corps d'une route est lu de façon asynchrone : on attend la diffusion de l'appel. */
async function attendreAppel(recus: MessageClient[]): Promise<Appel> {
  for (let i = 0; i < 200; i += 1) {
    const trouve = recus.find((m): m is Appel => m.type === 'module_appel');
    if (trouve) return trouve;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('aucun appel diffusé');
}

const DEMANDE = { module: 'carte', outil: 'centrer', arguments: { lat: 48.8, lon: 2.3 }, session: 'sess-1' };

describe('capacités des modules', () => {
  test('outils et intégrations des modules sains ; module en erreur absent ; sans outils, valide', async () => {
    const { appels, registre } = montage();
    expect(ManifesteModule.safeParse(MANIFESTE_MINIMAL).success).toBe(true);
    expect(appels.capacites()).toEqual([
      { module: 'carte', nom: 'Carte', outils: [OUTIL], integrations: [INTEGRATION] },
      { module: 'meteo', nom: 'Météo', outils: [], integrations: [] },
    ]);
    const http = (await lireCapacites(appels).json()) as unknown[];
    expect(http).toHaveLength(2);
    expect(registre.modules.lister()).toHaveLength(3);
  });
});

describe('appel d’un outil', () => {
  test('relayé à l’appli ouverte, qui répond : le résultat revient, sans bruit sur le long-poll', async () => {
    const { appels, diffusion } = montage();
    const recus: MessageClient[] = [];
    appli(diffusion, recus);
    const version = diffusion.version;
    const resultat = appels.appeler(DEMANDE);
    const appel = appelRecu(recus);
    expect(appel).toMatchObject({ type: 'module_appel', module: 'carte', outil: 'centrer', session: 'sess-1' });
    expect(appel.arguments).toEqual({ lat: 48.8, lon: 2.3 });
    expect(diffusion.version).toBe(version);
    expect(appels.repondre({ appel: appel.appel, ok: true, resultat: { centre: 'ok' } })).toBe(true);
    expect(await resultat).toEqual({ ok: true, resultat: { centre: 'ok' } });
  });

  test('« module absent » est ignoré tant qu’une autre appli répond', async () => {
    const { appels, diffusion } = montage();
    const recus: MessageClient[] = [];
    appli(diffusion, recus);
    appli(diffusion, recus);
    const resultat = appels.appeler(DEMANDE);
    const appel = appelRecu(recus).appel;
    appels.repondre({ appel, ok: false, erreur: MODULE_ABSENT });
    appels.repondre({ appel, ok: true, resultat: 42 });
    expect(await resultat).toEqual({ ok: true, resultat: 42 });
  });

  test('« module absent » sur toutes les applis : échec sans attendre le délai', async () => {
    const { appels, diffusion } = montage();
    const recus: MessageClient[] = [];
    appli(diffusion, recus);
    const resultat = appels.appeler(DEMANDE);
    appels.repondre({ appel: appelRecu(recus).appel, ok: false, erreur: MODULE_ABSENT });
    expect(await resultat).toMatchObject({ ok: false, erreur: expect.stringContaining('absent de toutes') });
  });

  test('sans réponse, échec propre après le délai injecté', async () => {
    const { appels, diffusion } = montage(20);
    appli(diffusion, []);
    const r = await appels.appeler(DEMANDE);
    expect(r).toMatchObject({ ok: false, erreur: expect.stringContaining("n'a pas répondu à temps") });
  });

  test('aucune appli ouverte : échec immédiat, rien n’est diffusé', async () => {
    const { appels } = montage(20);
    expect(await appels.appeler(DEMANDE)).toEqual({ ok: false, erreur: AUCUNE_APPLI });
  });

  test('un résultat de plus de 64 Ko est refusé ; une réponse à un appel inconnu aussi', async () => {
    const { appels, diffusion } = montage();
    const recus: MessageClient[] = [];
    appli(diffusion, recus);
    const resultat = appels.appeler(DEMANDE);
    const appel = appelRecu(recus).appel;
    appels.repondre({ appel, ok: true, resultat: 'x'.repeat(70 * 1024) });
    expect(await resultat).toMatchObject({ ok: false, erreur: expect.stringContaining('trop volumineux') });
    expect(appels.repondre({ appel, ok: true, resultat: 1 })).toBe(false);
  });
});

describe('routes HTTP des appels', () => {
  test('l’agent appelle, l’appli répond, l’agent reçoit le résultat', async () => {
    const { appels, diffusion } = montage();
    const recus: MessageClient[] = [];
    appli(diffusion, recus);
    const requete = new Request('http://relais.test/api/modules-appels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ module: 'carte', outil: 'centrer', arguments: { lat: 1 }, session: 'sess-1' }),
    });
    const reponse = appelerModule(appels, requete);
    const appel = (await attendreAppel(recus)).appel;
    const ack = await repondreModule(
      appels,
      new Request('http://relais.test/api/modules-reponses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appel, ok: true, resultat: { centre: [1, 2] } }),
      }),
    );
    expect(ack.status).toBe(200);
    expect(await (await reponse).json()).toEqual({ resultat: { centre: [1, 2] } });
  });

  test('sans appli : 409 avec le message, et une demande mal formée est refusée', async () => {
    const { appels } = montage();
    const r = await appelerModule(
      appels,
      new Request('http://relais.test/api/modules-appels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ module: 'carte', outil: 'centrer', session: 'sess-1' }),
      }),
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: AUCUNE_APPLI });
    const mal = await appelerModule(
      appels,
      new Request('http://relais.test/api/modules-appels', { method: 'POST', body: '{"module":"X"}' }),
    );
    expect(mal.status).toBe(400);
  });
});
