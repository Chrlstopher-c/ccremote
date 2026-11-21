// Responsabilité : tests des serveurs de modules sur le poste — lancement avec PORT injecté, état « pret », requêtes
// relayées (texte, base64, corps trop gros), redémarrage au changement de serveur/, relances avec recul puis panne,
// arrêt à la suppression du module. Serveurs de test : petits scripts Bun sur 127.0.0.1, arrêtés en fin de test.
// Données temporaires seulement ; aucune commande systemd-run (commande injectée).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { MessagePoste } from '../../../commun/protocole-poste.ts';
import { SurveillanceModules } from '../surveillance.ts';
import { validerModule, type ModuleValide } from '../validation.ts';
import { ServeursModules } from './serveurs.ts';

const journal = pino({ enabled: false });
const REGLAGES = {
  commande: (point: string) => ['bun', 'run', point],
  delais: [50, 100, 150],
  delaiPretMs: 8_000,
  delaiStableMs: 60_000,
  delaiArretMs: 2_000,
};

const SERVEUR_ECHO = `
Bun.serve({
  port: Number(process.env.PORT),
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    return Response.json({
      pid: process.pid, port: process.env.PORT, id: process.env.MODULE_ID,
      methode: req.method, chemin: url.pathname + url.search, corps: await req.text(),
    });
  },
});
`;

const SERVEUR_PLANTE = `
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
appendFileSync(join(process.env.MODULE_DONNEES, 'lancements'), 'x');
Bun.serve({ port: Number(process.env.PORT), hostname: '127.0.0.1', fetch: () => new Response('ok') });
setTimeout(() => process.exit(3), 400);
`;

let racine = '';
let serveurs: ServeursModules | null = null;
let envois: MessagePoste[] = [];

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'quart-serveurs-poste-'));
  envois = [];
});

afterEach(async () => {
  await serveurs?.arreterTout();
  serveurs = null;
  rmSync(racine, { recursive: true, force: true });
});

function manifeste(id: string, serveur: Record<string, unknown> | null): string {
  const base: Record<string, unknown> = {
    id,
    nom: 'Carte',
    version: '1.0.0',
    description: 'Test',
    icone: 'map',
    point: 'index.js',
    emplacements: ['panneau'],
  };
  return JSON.stringify(serveur === null ? base : { ...base, serveur });
}

/** Un module de la source : index.js, et serveur/index.ts si `code` est fourni. */
function ecrireModule(
  id: string,
  code: string | null,
  serveur: Record<string, unknown> | null = { point: 'serveur/index.ts' },
): string {
  const dossier = join(racine, 'src', id);
  mkdirSync(join(dossier, 'serveur'), { recursive: true });
  writeFileSync(join(dossier, 'module.json'), manifeste(id, code === null ? null : serveur));
  writeFileSync(join(dossier, 'index.js'), 'export default function activer() {}');
  if (code !== null) writeFileSync(join(dossier, 'serveur', 'index.ts'), code);
  return dossier;
}

function valide(dossier: string, id: string): ModuleValide {
  const r = validerModule(dossier, id);
  if (!r.ok) throw new Error(r.erreur);
  return r.module;
}

function montage(machine = 'tour'): ServeursModules {
  serveurs = new ServeursModules({
    machine,
    dossierDonnees: join(racine, 'donnees'),
    dossierJournaux: join(racine, 'journal'),
    envoyer: (m) => envois.push(m),
    journal,
    reglages: REGLAGES,
  });
  return serveurs;
}

function etatsAnnonces(etat: string): number {
  return envois.filter((m) => m.kind === 'module_serveur' && m.etat === etat).length;
}

async function attendre(condition: () => boolean, delaiMs = 15_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await Bun.sleep(50);
  }
}

async function reponseJson(s: ServeursModules, chemin: string): Promise<Record<string, unknown>> {
  const r = await s.requete('carte', { chemin });
  if (!r.ok) throw new Error(r.erreur);
  return JSON.parse(r.donnees.body) as Record<string, unknown>;
}

function vivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('lancement et requêtes', () => {
  test('le serveur est lancé avec PORT, passe à « pret », et une requête atteint le serveur', async () => {
    const dossier = ecrireModule('carte', SERVEUR_ECHO);
    const s = montage();
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await attendre(() => etatsAnnonces('pret') === 1);
    expect(existsSync(join(racine, 'donnees', 'carte'))).toBe(true);
    const r = await s.requete('carte', {
      chemin: '/api/ping?x=1',
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'bonjour',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.donnees.status).toBe(200);
    expect(r.donnees.encodage).toBe('texte');
    expect(r.donnees.headers['content-type']).toContain('application/json');
    expect(JSON.parse(r.donnees.body)).toMatchObject({
      id: 'carte',
      methode: 'POST',
      chemin: '/api/ping?x=1',
      corps: 'bonjour',
    });
  });

  test('une réponse binaire revient en base64', async () => {
    const code = `Bun.serve({ port: Number(process.env.PORT), hostname: '127.0.0.1',
      fetch: () => new Response(new Uint8Array([255, 0, 16]), { headers: { 'content-type': 'image/png' } }) });`;
    const dossier = ecrireModule('carte', code);
    const s = montage();
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await attendre(() => etatsAnnonces('pret') === 1);
    const r = await s.requete('carte', { chemin: '/image.png' });
    const attendu = Buffer.from([255, 0, 16]).toString('base64');
    expect(r.ok && r.donnees.encodage === 'base64' && r.donnees.body === attendu).toBe(true);
  });

  test('un corps de requête de plus de 4 Mo est refusé sans rien envoyer', async () => {
    const dossier = ecrireModule('carte', SERVEUR_ECHO);
    const s = montage();
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await attendre(() => etatsAnnonces('pret') === 1);
    const r = await s.requete('carte', { chemin: '/', method: 'POST', body: 'x'.repeat(5 * 1024 * 1024) });
    expect(r).toEqual({ ok: false, erreur: 'corps trop volumineux (4 Mo au plus)' });
  });

  test('sans serveur pour ce module : la requête est refusée avec la raison', async () => {
    const dossier = ecrireModule('carte', null);
    const s = montage();
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    const r = await s.requete('carte', { chemin: '/' });
    expect(r).toEqual({ ok: false, erreur: 'aucun serveur pour ce module sur cette machine' });
  });

  test('un serveur déclaré pour une autre machine ne se lance pas ici', async () => {
    const dossier = ecrireModule('carte', SERVEUR_ECHO, { point: 'serveur/index.ts', machine: 'pi' });
    const s = montage('tour');
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await Bun.sleep(200);
    expect(envois.filter((m) => m.kind === 'module_serveur')).toEqual([]);
    expect((await s.requete('carte', { chemin: '/' })).ok).toBe(false);
  });

  test('un serveur avec package.json s’installe (bun install) et démarre ; son bun.lock ne le redémarre pas', async () => {
    const dossier = ecrireModule('carte', SERVEUR_ECHO);
    writeFileSync(join(dossier, 'serveur', 'package.json'), JSON.stringify({ name: 'carte', private: true }));
    const s = montage();
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await attendre(() => etatsAnnonces('pret') === 1);
    writeFileSync(join(dossier, 'serveur', 'bun.lock'), '{}');
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await Bun.sleep(300);
    expect(etatsAnnonces('demarrage')).toBe(1);
    expect((await s.requete('carte', { chemin: '/' })).ok).toBe(true);
  }, 30_000);

  test('republier renvoie l’état courant du serveur', async () => {
    const dossier = ecrireModule('carte', SERVEUR_ECHO);
    const s = montage();
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await attendre(() => etatsAnnonces('pret') === 1);
    envois.length = 0;
    s.republier();
    expect(envois).toEqual([{ kind: 'module_serveur', id: 'carte', etat: 'pret' }]);
  });
});

describe('cycle de vie', () => {
  test('une modification de serveur/ redémarre le serveur ; une modification du client non', async () => {
    const dossier = ecrireModule('carte', SERVEUR_ECHO);
    const s = montage();
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await attendre(() => etatsAnnonces('pret') === 1);
    const pidAvant = await reponseJson(s, '/');

    writeFileSync(join(dossier, 'index.js'), 'export default function activer() { return 1; }');
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await Bun.sleep(400);
    expect(etatsAnnonces('demarrage')).toBe(1);

    writeFileSync(join(dossier, 'serveur', 'index.ts'), `${SERVEUR_ECHO}\n// v2`);
    s.synchroniser('carte', dossier, valide(dossier, 'carte'));
    await attendre(() => etatsAnnonces('pret') === 2);
    const pidApres = await reponseJson(s, '/');
    expect(pidApres.pid).not.toBe(pidAvant.pid);
  });

  test('un plantage relance avec recul, puis passe en panne', async () => {
    const dossier = ecrireModule('plante', SERVEUR_PLANTE);
    const s = montage();
    s.synchroniser('plante', dossier, valide(dossier, 'plante'));
    await attendre(() => envois.some((m) => m.kind === 'module_serveur' && m.etat === 'panne'), 30_000);
    const lancements = readFileSync(join(racine, 'donnees', 'plante', 'lancements'), 'utf8');
    expect(lancements).toBe('xxxx');
    const relances = envois
      .filter((m) => m.kind === 'module_serveur' && m.etat === 'demarrage' && m.erreur?.includes('relance'))
      .map((m) => (m.kind === 'module_serveur' ? m.erreur : ''));
    expect(relances.map((e) => e?.match(/(\d+) ms/)?.[1])).toEqual(['50', '100', '150']);
    const panne = await s.requete('plante', { chemin: '/' });
    expect(panne.ok).toBe(false);
    if (!panne.ok) expect(panne.erreur).toContain('en panne');
  }, 40_000);

  test('un module retiré arrête son serveur : le processus n’existe plus', async () => {
    const dossier = ecrireModule('carte', SERVEUR_ECHO);
    const s = montage();
    const surveillance = new SurveillanceModules({
      dossier: join(racine, 'src'),
      envoyer: (m) => envois.push(m),
      journal,
      delaiMs: 40,
      periodeMs: 60_000,
      serveurs: s,
    });
    surveillance.demarrer();
    try {
      surveillance.synchroniser();
      await attendre(() => etatsAnnonces('pret') === 1);
      const pid = Number((await reponseJson(s, '/')).pid);
      expect(vivant(pid)).toBe(true);
      rmSync(dossier, { recursive: true, force: true });
      surveillance.synchroniser();
      await attendre(() => !vivant(pid));
    } finally {
      surveillance.arreter();
    }
  });
});
