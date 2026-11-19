import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import pino from 'pino';
import { listerMachines, modifierMachine, supprimerMachine, testerMachine } from './machines-outils.ts';

// Faux relais : une confirmation dont l'issue est choisie par le test (accordee ou refusee).
let issue: 'accordee' | 'refusee' = 'refusee';
const appels: string[] = [];
const journal = pino({ level: 'silent' });
let serveur: ReturnType<typeof Bun.serve>;
let api: { url: string; jeton: string };

beforeAll(() => {
  serveur = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      appels.push(`${req.method} ${u.pathname}`);
      if (req.headers.get('authorization') !== 'Bearer jeton-test') return new Response('{}', { status: 401 });
      if (u.pathname === '/api/confirmations' && req.method === 'POST') return Response.json({ id: 'c1' }, { status: 201 });
      if (u.pathname === '/api/confirmations/c1/attendre') return Response.json({ id: 'c1', statut: issue });
      if (u.pathname === '/api/machines/config') {
        return Response.json({ machines: [{ id: 'vps', hote: 'h', dossier: '~', enLigne: false, posteInstalle: true }] });
      }
      if (u.pathname === '/api/machines/config/vps/tester') {
        return Response.json({ ssh: { ok: true, detail: 'connexion ok' }, claude: { ok: false, detail: 'absent' } });
      }
      if (u.pathname === '/api/machines/config/vps') return Response.json({ id: 'vps' });
      return Response.json({ erreur: 'route inconnue' }, { status: 404 });
    },
  });
  api = { url: `http://127.0.0.1:${serveur.port}`, jeton: 'jeton-test' };
});

afterAll(() => {
  serveur.stop(true);
});

describe('outils machines', () => {
  test('lister : une ligne par machine, état du poste', async () => {
    const r = await listerMachines(api);
    expect(r.erreur).toBe(false);
    expect(r.texte).toContain('- vps : h, dossier ~, poste hors ligne');
  });

  test('tester : une ligne par étape', async () => {
    const r = await testerMachine(api, 'vps');
    expect(r.texte).toContain('ssh : ok (connexion ok)');
    expect(r.texte).toContain('claude : échec (absent)');
  });

  test('supprimer sans accord : rien n’est appelé après la confirmation', async () => {
    issue = 'refusee';
    appels.length = 0;
    const r = await supprimerMachine(api, 'vps', journal);
    expect(r.texte).toContain("rien n'a été modifié");
    expect(appels).not.toContain('DELETE /api/machines/config/vps');
  });

  test('supprimer avec accord : la suppression part', async () => {
    issue = 'accordee';
    appels.length = 0;
    const r = await supprimerMachine(api, 'vps', journal);
    expect(r.texte).toBe('Machine « vps » supprimée.');
    expect(appels).toContain('DELETE /api/machines/config/vps');
  });

  test('modifier sans accord : aucune modification', async () => {
    issue = 'refusee';
    appels.length = 0;
    await modifierMachine(api, 'vps', { dossier: '~/dev' }, journal);
    expect(appels.some((a) => a.startsWith('PATCH'))).toBe(false);
  });
});
