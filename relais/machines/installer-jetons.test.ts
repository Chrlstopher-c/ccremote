// Responsabilité : test de la réinstallation d'un poste — un jeton API par installation, l'ancien révoqué si la nouvelle
// réussit, le sien révoqué si elle échoue.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Acces } from '../acces/acces.ts';
import { PlafondEchecs } from '../acces/plafond.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { ApiMachines, type DependancesMachines } from './api-machines.ts';
import { ELEMENTS_CODE } from './installer.ts';
import { RegistreMachines } from './registre-machines.ts';
import { Ssh, type ResultatSsh } from './ssh.ts';

const journal = pino({ level: 'silent' });
const CLE = join(mkdtempSync(join(tmpdir(), 'cle-jetons-')), 'cle');
writeFileSync(CLE, 'x');
const CONFIG = { id: 'vps-test', hote: 'machine.exemple.test', utilisateur: 'utilisateur', cle: CLE };
const NOM = 'poste vps-test';

function racineCode(): string {
  const racine = mkdtempSync(join(tmpdir(), 'racine-jetons-'));
  for (const element of ELEMENTS_CODE) {
    if (element.includes('.')) writeFileSync(join(racine, element), '{}');
    else mkdirSync(join(racine, element));
  }
  return racine;
}

function rig(sortieSsh: Partial<ResultatSsh>) {
  const acces = new Acces(
    new Registre(ouvrirBase(':memory:')),
    'empreinte-inutilisee',
    new PlafondEchecs(join(mkdtempSync(join(tmpdir(), 'echecs-jetons-')), 'e.json'), journal),
  );
  const ssh = new Ssh(async () => ({ code: 0, sortie: 'ok', erreurs: '', delaiDepasse: false, ...sortieSsh }));
  const d: DependancesMachines = {
    registre: new RegistreMachines(ouvrirBase(':memory:')),
    postes: { enLigne: () => false, rafraichirMachine: () => undefined, commander: async () => ({ ok: false }) },
    ssh,
    secrets: new Map<string, string>(),
    dossierSecrets: mkdtempSync(join(tmpdir(), 'sec-jetons-')),
    relaisPostes: 'ws://relais.exemple.test/poste',
    racineCode: racineCode(),
    acces,
    urlApi: 'http://api.exemple.test',
    journal,
    maintenant: () => '2026-11-19T00:00:00.000Z',
  };
  return { api: new ApiMachines(d), acces };
}

const post = (corps: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(corps) });
const installer = (api: ApiMachines) =>
  api.installer(Object.assign(new Request('http://x'), { params: { id: 'vps-test' } }));

test('réinstallation réussie : le jeton de la précédente installation est révoqué, un seul reste', async () => {
  const { api, acces } = rig({});
  await api.ajouter(post(CONFIG));
  const ancien = acces.emettre({ nom: NOM, genre: 'claude-code', jours: 365 });
  expect((await installer(api)).status).toBe(200);
  const actifs = acces.idsDeAppareil(NOM, 'claude-code');
  expect(actifs).toHaveLength(1);
  expect(actifs).not.toContain(ancien.id);
});

test('installation échouée : le jeton émis pour elle est révoqué, celui de la précédente reste', async () => {
  const { api, acces } = rig({ code: 1, sortie: 'refusé' });
  await api.ajouter(post(CONFIG));
  const ancien = acces.emettre({ nom: NOM, genre: 'claude-code', jours: 365 });
  expect((await installer(api)).status).toBe(409);
  expect(acces.idsDeAppareil(NOM, 'claude-code')).toEqual([ancien.id]);
});
