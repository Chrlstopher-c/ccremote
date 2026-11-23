// Responsabilité : la dictée et la voix d'un pair vues d'un autre nœud — service agrégé des pairs, pilotage d'une
// machine distante (dictée, voix) et transcription relayée au pair qui tient la machine. Deux nœuds réels sur un
// aiguilleur réel (127.0.0.1). Données de test seulement.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { Postes } from '../parc/postes.ts';
import { ApiDictee } from '../reste/api-dictee.ts';
import { attendre } from './banc-federation.ts';
import type { GesteLocal } from './echanges.ts';
import { appairer, arreterBanc, demarrerBanc, nouveau, requete } from './parite-banc.ts';

const JOURNAL = pino({ enabled: false });
const SERVICE_DICTEE = {
  machine: 'tour',
  installe: true,
  etat: 'arrete',
  depuis: null,
  chargementMs: null,
  memoireGpuMo: null,
  latenceMs: null,
  derniereActivite: null,
  arretInactiviteMin: 15,
  lanceParPoste: false,
  message: null,
};
const SERVICE_VOIX = { machine: 'tour', installe: true, etat: 'arrete', depuis: null, message: null };
const SANS_POSTE = {
  vues: () => [],
  commander: async () => {
    throw new Error('aucun poste local dans cet essai');
  },
} as unknown as Pick<Postes, 'vues' | 'commander'>;

// La tour (B) répond à ses services comme un poste réel le ferait ; le reste passe au pont factice.
function gestesTour(g: GesteLocal): Response | undefined {
  if (g.geste === 'dictee/service') return Response.json({ machines: [SERVICE_DICTEE] });
  if (g.geste === 'voix/service') return Response.json({ machines: [SERVICE_VOIX] });
  if (g.geste === 'dictee') return Response.json({ etat: 'ok', texte: 'bonjour', ms: 12, machine: 'tour' });
  return undefined;
}

beforeEach(() => demarrerBanc());
afterEach(() => arreterBanc());

describe('service de dictée et de voix des pairs', () => {
  test('le portable voit le service de dictée et de voix de la tour, interrogée en local=1', async () => {
    const b = await nouveau('tour', gestesTour);
    const a = await nouveau('portable');
    await appairer(a, b);
    await attendre(async () => (await a.federation.distantes.dicteeServiceDesPairs()).length === 1);
    expect(await a.federation.distantes.dicteeServiceDesPairs()).toEqual([SERVICE_DICTEE]);
    expect(await a.federation.distantes.voixServiceDesPairs()).toEqual([SERVICE_VOIX]);
    expect(b.appels.gestes.map((g) => [g.geste, g.requete])).toContainEqual(['dictee/service', 'local=1']);
    expect(b.appels.gestes.map((g) => g.geste)).toContain('voix/service');
  });
});

describe('pilotage d’une machine distante', () => {
  test('démarrer ou arrêter la dictée et la voix de la tour : la requête arrive à la tour', async () => {
    const b = await nouveau('tour', gestesTour);
    const a = await nouveau('portable');
    await appairer(a, b);
    await attendre(() => a.federation.distantes.membreDeMachine('tour') !== null);
    const corps = '{"action":"demarrer"}';
    const dictee = await a.federation.distantes.intercepter(requete('/api/machines/tour/dictee', 'POST', corps));
    const voix = await a.federation.distantes.intercepter(requete('/api/machines/tour/voix', 'POST', corps));
    expect(dictee?.status).toBe(200);
    expect(voix?.status).toBe(200);
    const recus = b.appels.gestes;
    expect(recus).toContainEqual(expect.objectContaining({ geste: 'dictee', methode: 'POST', machine: 'tour', corps }));
    expect(recus).toContainEqual(expect.objectContaining({ geste: 'voix', methode: 'POST', machine: 'tour', corps }));
  });
});

describe('transcription sur la machine d’un pair', () => {
  test('POST /api/dictee nommant la tour : transcrite sur la tour, rendue par le portable', async () => {
    const b = await nouveau('tour', gestesTour);
    const a = await nouveau('portable');
    await appairer(a, b);
    await attendre(() => a.federation.distantes.membreDeMachine('tour') !== null);
    const d = a.federation.distantes;
    const api = new ApiDictee({
      postes: SANS_POSTE,
      journal: JOURNAL,
      pairs: {
        dicteeServiceDesPairs: () => d.dicteeServiceDesPairs(),
        membreDeMachine: (machine) => d.membreDeMachine(machine),
        transcrireChez: (membre, corps) => d.transcrireChez(membre, corps),
      },
    });
    const r = await api.transcrire(requete('/api/dictee', 'POST', '{"pcm16":"AAAA","machine":"tour"}'));
    expect(await r.json()).toEqual({ etat: 'ok', texte: 'bonjour', ms: 12, machine: 'tour' });
    const relayee = b.appels.gestes.find((g) => g.geste === 'dictee');
    expect(relayee).toMatchObject({ methode: 'POST', requete: 'local=1' });
    expect(JSON.parse(relayee?.corps ?? '{}')).toEqual({ pcm16: 'AAAA', machine: 'tour' });
  });
});
