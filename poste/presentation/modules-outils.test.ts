// Responsabilité : tests des outils `modules` côté poste — lister et appeler passent par un relais factice (HTTP),
// afficher n'émet qu'un événement `integration` exact et refuse les données de plus de 64 Ko.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { afficherModule, appelerModule, listerModules } from './modules-outils.ts';
import type { ContexteOutils } from './outils.ts';
import { Stockage } from './stockage.ts';

const journal = pino({ level: 'silent' });
const requetes: { methode: string; chemin: string; corps: unknown }[] = [];
let serveur: ReturnType<typeof Bun.serve>;
let api: { url: string; jeton: string };

beforeAll(() => {
  serveur = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const corps: unknown = req.method === 'POST' ? await req.json() : null;
      requetes.push({ methode: req.method, chemin: u.pathname, corps });
      if (req.headers.get('authorization') !== 'Bearer jeton-test') {
        return Response.json({ erreur: 'refusé' }, { status: 401 });
      }
      if (u.pathname === '/api/modules-outils') {
        return Response.json([{ module: 'carte', nom: 'Carte', outils: [{ nom: 'centrer' }], integrations: [] }]);
      }
      if (u.pathname === '/api/modules-appels') {
        const d = corps as { module: string };
        if (d.module === 'absent') return Response.json({ erreur: 'aucune appli' }, { status: 409 });
        return Response.json({ resultat: { centre: 'ok', recu: corps } });
      }
      return Response.json({ erreur: 'route inconnue' }, { status: 404 });
    },
  });
  api = { url: `http://127.0.0.1:${serveur.port}`, jeton: 'jeton-test' };
});

afterAll(() => {
  serveur.stop(true);
});

function banc(): { c: ContexteOutils; evenements: Evenement[] } {
  const racine = mkdtempSync(join(tmpdir(), 'modules-outils-'));
  const evenements: Evenement[] = [];
  const c: ContexteOutils = {
    sessionId: 'sess-1',
    cwd: racine,
    racines: [racine],
    stockage: new Stockage(join(racine, 'donnees')),
    emettre: (evt) => evenements.push(evt),
    journal,
  };
  return { c, evenements };
}

describe('modules_lister', () => {
  test('rend les modules du relais, avec leurs outils', async () => {
    const r = await listerModules(api, journal);
    expect(r.erreur).toBe(false);
    expect(JSON.parse(r.texte)).toEqual({
      modules: [{ module: 'carte', nom: 'Carte', outils: [{ nom: 'centrer' }], integrations: [] }],
    });
  });

  test('relais injoignable : refus lisible, pas d’exception', async () => {
    const r = await listerModules({ url: 'http://127.0.0.1:1', jeton: 'jeton-test' }, journal);
    expect(r).toMatchObject({ erreur: true, texte: expect.stringContaining('relais injoignable') });
  });
});

describe('module_appeler', () => {
  test('transmet le module, l’outil, les arguments et la session ; rend le résultat', async () => {
    const r = await appelerModule(api, journal, 'sess-1', { module: 'carte', outil: 'centrer', arguments: { lat: 1 } });
    expect(r.erreur).toBe(false);
    expect(JSON.parse(r.texte)).toMatchObject({ centre: 'ok' });
    const envoi = requetes.filter((q) => q.chemin === '/api/modules-appels').pop();
    expect(envoi?.corps).toEqual({ module: 'carte', outil: 'centrer', arguments: { lat: 1 }, session: 'sess-1' });
  });

  test('erreur du relais : l’erreur est rendue à l’agent', async () => {
    const r = await appelerModule(api, journal, 'sess-1', { module: 'absent', outil: 'centrer' });
    expect(r).toMatchObject({ erreur: true, texte: 'Échec : aucune appli' });
  });
});

describe('module_afficher', () => {
  test('émet exactement l’événement `integration` du fil', () => {
    const { c, evenements } = banc();
    const donnees = { lieux: [{ nom: 'Bar', lat: 48.8, lon: 2.3 }] };
    const r = afficherModule(c, { module: 'carte', integration: 'lieux', donnees, titre: 'Bars' });
    expect(r.erreur).toBe(false);
    expect(evenements).toEqual([
      { type: 'integration', module: 'carte', integration: 'lieux', donnees, titre: 'Bars' },
    ]);
  });

  test('sans titre, pas de champ titre ; données de plus de 64 Ko refusées sans événement', () => {
    const { c, evenements } = banc();
    afficherModule(c, { module: 'carte', integration: 'lieux', donnees: { a: 1 } });
    expect(evenements[0]).toEqual({ type: 'integration', module: 'carte', integration: 'lieux', donnees: { a: 1 } });
    const trop = afficherModule(c, { module: 'carte', integration: 'lieux', donnees: { t: 'x'.repeat(65 * 1024) } });
    expect(trop.erreur).toBe(true);
    expect(evenements.filter((e) => e.type === 'integration')).toHaveLength(1);
  });
});
