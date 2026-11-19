import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ouvrirBase } from '../registre/base.ts';
import { ApiMachines, type DependancesMachines } from './api-machines.ts';
import { RegistreMachines } from './registre-machines.ts';
import { Ssh, type ResultatSsh } from './ssh.ts';

const journal = pino({ level: 'silent' });
const CLE = join(mkdtempSync(join(tmpdir(), 'cle-test-')), 'cle');
writeFileSync(CLE, 'x');

function rig(sortieSsh: Partial<ResultatSsh> = {}) {
  const secrets = new Map<string, string>();
  const registre = new RegistreMachines(ouvrirBase(':memory:'));
  const ssh = new Ssh(async () => ({ code: 0, sortie: '/srv\n/root\nalpha\n', erreurs: '', delaiDepasse: false, ...sortieSsh }));
  const d: DependancesMachines = {
    registre,
    postes: { enLigne: (id: string) => id === 'tour', commander: async () => ({ ok: true, donnees: { chemin: '/mnt', parent: '/', accueil: '/h', entrees: [] } }) },
    ssh,
    secrets,
    dossierSecrets: mkdtempSync(join(tmpdir(), 'sec-test-')),
    relaisPostes: null,
    racineCode: '/nonexistent',
    acces: { emettre: () => ({ id: 'x', jeton: 'j' }) },
    urlApi: null,
    journal,
    maintenant: () => '2026-11-19T00:00:00.000Z',
  };
  return { api: new ApiMachines(d), d };
}

const post = (corps: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(corps) });
const CONFIG = { id: 'vps-test', hote: 'machine.exemple.test', utilisateur: 'utilisateur', cle: CLE };

describe('routes des machines configurées', () => {
  test('ajouter : 201, puis doublon 409, clé absente 400, id réservé 400', async () => {
    const { api } = rig();
    expect((await api.ajouter(post(CONFIG))).status).toBe(201);
    expect((await api.ajouter(post(CONFIG))).status).toBe(409);
    expect((await api.ajouter(post({ ...CONFIG, id: 'autre', cle: '/absente/cle' }))).status).toBe(400);
    expect((await api.ajouter(post({ ...CONFIG, id: 'config' }))).status).toBe(400);
  });

  test('liste : état de connexion et d’installation du poste', async () => {
    const { api, d } = rig();
    await api.ajouter(post(CONFIG));
    d.secrets.set('vps-test', 's');
    const corps = (await api.liste().json()) as { machines: { id: string; enLigne: boolean; posteInstalle: boolean }[] };
    expect(corps.machines[0]).toMatchObject({ id: 'vps-test', enLigne: false, posteInstalle: true });
  });

  test('modifier partiellement, puis supprimer (404 ensuite)', async () => {
    const { api } = rig();
    await api.ajouter(post(CONFIG));
    const req = new Request('http://x', { method: 'PATCH', body: JSON.stringify({ dossier: '~/dev' }) });
    const modifiee = await api.modifier(Object.assign(req, { params: { id: 'vps-test' } }));
    expect(((await modifiee.json()) as { dossier: string }).dossier).toBe('~/dev');
    const sup = (req2: Request) => Object.assign(req2, { params: { id: 'vps-test' } });
    expect((await api.supprimer(sup(new Request('http://x', { method: 'DELETE' })))).status).toBe(200);
    expect((await api.supprimer(sup(new Request('http://x', { method: 'DELETE' })))).status).toBe(404);
  });

  test('dossiers : ssh pour une machine configurée, poste connecté sinon', async () => {
    const { api } = rig();
    await api.ajouter(post(CONFIG));
    const avec = (id: string, chemin = '') =>
      Object.assign(new Request(`http://x/api?chemin=${encodeURIComponent(chemin)}`), { params: { id } });
    const ssh = await api.dossiers(avec('vps-test', '/srv'));
    expect(ssh.status).toBe(200);
    expect(((await ssh.json()) as { entrees: unknown[] }).entrees.length).toBe(1);
    expect((await api.dossiers(avec('tour', '/mnt'))).status).toBe(200);
    expect((await api.dossiers(avec('inconnue'))).status).toBe(409);
  });

  test('chemin distant invalide : 400', async () => {
    const { api } = rig();
    await api.ajouter(post(CONFIG));
    const req = Object.assign(new Request('http://x/api?chemin=relatif'), { params: { id: 'vps-test' } });
    expect((await api.dossiers(req)).status).toBe(400);
  });

  test('installer sans adresse du relais : 409, sans toucher à la machine', async () => {
    const { api } = rig();
    await api.ajouter(post(CONFIG));
    const req = Object.assign(new Request('http://x', { method: 'POST' }), { params: { id: 'vps-test' } });
    expect((await api.installer(req)).status).toBe(409);
  });
});
