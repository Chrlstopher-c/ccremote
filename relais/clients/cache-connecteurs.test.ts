import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ConnecteurMachine } from '../../commun/configuration.ts';
import { CacheConnecteurs, DUREE_CACHE_CONNECTEURS_MS } from './cache-connecteurs.ts';

const silencieux = pino({ enabled: false });
const LISTE: ConnecteurMachine[] = [{ nom: 'exemple', cible: '/fictif', etat: 'connecte' }];

// Relecture immédiate, qui compte les appels.
function relecture(valeur: ConnecteurMachine[] = LISTE) {
  const appels: string[] = [];
  const relire = (machine: string): Promise<{ ok: true; connecteurs: ConnecteurMachine[] }> => {
    appels.push(machine);
    return Promise.resolve({ ok: true, connecteurs: valeur });
  };
  return { relire, appels };
}

// Relecture de test : compte les appels ; `liberer` résout toutes les relectures en attente.
function relecturePilotee() {
  const appels: string[] = [];
  const attentes: (() => void)[] = [];
  const relire = (machine: string): Promise<{ ok: true; connecteurs: ConnecteurMachine[] }> => {
    appels.push(machine);
    return new Promise((resoudre) => attentes.push(() => resoudre({ ok: true, connecteurs: LISTE })));
  };
  return { relire, appels, liberer: () => attentes.splice(0).forEach((resoudre) => resoudre()) };
}

describe('CacheConnecteurs', () => {
  test('premier appel relu sur le poste, avec sa fraîcheur ISO', async () => {
    const { relire, appels } = relecture();
    const cache = new CacheConnecteurs(relire, silencieux, () => 1_000);
    const r = await cache.lire('tour');
    expect(r).toEqual({ ok: true, valeur: { connecteurs: LISTE, fraicheur: new Date(1_000).toISOString() } });
    expect(appels).toEqual(['tour']);
  });

  test('liste gardée servie tout de suite avec sa fraîcheur, relecture en arrière-plan', async () => {
    const { relire, appels } = relecture();
    let t = 1_000;
    const cache = new CacheConnecteurs(relire, silencieux, () => t);
    await cache.lire('tour');
    t = 5_000;
    const r = await cache.lire('tour');
    expect(r).toEqual({ ok: true, valeur: { connecteurs: LISTE, fraicheur: new Date(1_000).toISOString() } });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    expect(appels).toEqual(['tour', 'tour']);
  });

  test('au-delà de 10 minutes : relecture avant de répondre', async () => {
    const { relire } = relecture();
    let t = 0;
    const cache = new CacheConnecteurs(relire, silencieux, () => t);
    await cache.lire('tour');
    t = DUREE_CACHE_CONNECTEURS_MS;
    const r = await cache.lire('tour');
    expect(r.ok && r.valeur.fraicheur).toBe(new Date(DUREE_CACHE_CONNECTEURS_MS).toISOString());
  });

  test('invalidation : la prochaine lecture repart du poste, une relecture partie avant ne remplit pas le cache', async () => {
    const { relire, appels, liberer } = relecturePilotee();
    const cache = new CacheConnecteurs(relire, silencieux, () => 0);
    const premiere = cache.lire('tour');
    liberer();
    await premiere;
    const enVol = cache.lire('tour'); // liste gardée servie, relecture de fond en cours
    cache.invalider('tour');
    liberer();
    expect((await enVol).ok).toBe(true);
    const suivante = cache.lire('tour'); // périmée : relecture obligatoire
    expect(appels).toEqual(['tour', 'tour', 'tour']);
    liberer();
    expect((await suivante).ok).toBe(true);
  });

  test('une machine ne voit pas le cache d’une autre', async () => {
    const { relire, appels } = relecture();
    const cache = new CacheConnecteurs(relire, silencieux, () => 0);
    await cache.lire('tour');
    await cache.lire('pi');
    expect(appels).toEqual(['tour', 'pi']);
  });

  test('relecture refusée sans liste gardée : erreur rendue, rien n’est gardé', async () => {
    let appels = 0;
    const cache = new CacheConnecteurs(async () => {
      appels += 1;
      return { ok: false, erreur: 'délai dépassé' };
    }, silencieux);
    expect(await cache.lire('tour')).toEqual({ ok: false, erreur: 'délai dépassé' });
    await cache.lire('tour');
    expect(appels).toBe(2);
  });
});
