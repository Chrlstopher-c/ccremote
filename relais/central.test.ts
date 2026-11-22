// Essai du relais central : vrai processus relais::bin.ts en mode central, deux adresses de boucle locale, données de
// test dans un dossier temporaire. Vérifie : les deux adresses répondent, aucun tunnel SSH (ni même d'enfant), appairage
// par code (CLI, puis échange) → clé acceptée par /api/etat, sans clé refusée, code à usage unique, arrêt par notre PID.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RACINE = join(import.meta.dir, '..');
const CODE_CLE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;

interface Relais {
  readonly processus: ReturnType<typeof Bun.spawn>;
  readonly env: Record<string, string>;
  readonly web1: number;
  readonly web2: number;
  readonly postes: number;
}

let relais: Relais | null = null;

function portLibre(): number {
  const s = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const port = s.port;
  s.stop(true);
  return port;
}

function environnement(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (valeur === undefined || cle.startsWith('CCREMOTE_') || cle.startsWith('LANTERNE_')) continue;
    base[cle] = valeur;
  }
  return { ...base, ...extra };
}

async function attendre(url: string, statut: number): Promise<void> {
  const fin = Date.now() + 20_000;
  while (Date.now() < fin) {
    try {
      if ((await fetch(url)).status === statut) return;
    } catch {
      // le relais n'écoute pas encore
    }
    await Bun.sleep(150);
  }
  throw new Error(`pas de réponse ${statut} sur ${url}`);
}

async function lancer(args: string[], env: Record<string, string>): Promise<string> {
  const p = Bun.spawn([process.execPath, 'run', 'relais/commande.ts', ...args], {
    cwd: RACINE,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const sortie = await new Response(p.stdout).text();
  const code = await p.exited;
  if (code !== 0) throw new Error(`commande ${args.join(' ')} en échec : ${await new Response(p.stderr).text()}`);
  return sortie;
}

async function enfantsDe(pid: number): Promise<string> {
  const p = Bun.spawn(['pgrep', '-P', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
  const sortie = await new Response(p.stdout).text();
  await p.exited;
  return sortie.trim();
}

beforeAll(async () => {
  const donnees = mkdtempSync(join(tmpdir(), 'relais-central-essai-'));
  const web1 = portLibre();
  const web2 = portLibre();
  const postes = portLibre();
  const env = environnement({
    LANTERNE_RELAIS_MODE: 'central',
    LANTERNE_RELAIS_ECOUTE: `127.0.0.1:${web1},127.0.0.1:${web2}`,
    LANTERNE_RELAIS_PORT_POSTES: String(postes),
    LANTERNE_RELAIS_DONNEES: donnees,
    // Un tunnel intégré est demandé : le mode central doit l'ignorer.
    LANTERNE_MOTEUR_PORT_POSTES: String(portLibre()),
    CCREMOTE_EMPREINTE_MOT_DE_PASSE: await Bun.password.hash('essai', { algorithm: 'bcrypt', cost: 4 }),
    LANTERNE_DUO_ECOUTE: '127.0.0.1',
    LANTERNE_DUO_PORT: String(portLibre()),
    CCREMOTE_WEB: join(donnees, 'web-absente'),
    CCREMOTE_HQ: join(donnees, 'hq-absente'),
  });
  const processus = Bun.spawn([process.execPath, 'run', 'relais/bin.ts'], {
    cwd: RACINE,
    env,
    stdout: Bun.file(join(donnees, 'relais.log')),
    stderr: Bun.file(join(donnees, 'relais.err')),
  });
  relais = { processus, env, web1, web2, postes };
  await attendre(`http://127.0.0.1:${web1}/api/etat`, 401);
  await attendre(`http://127.0.0.1:${web2}/api/etat`, 401);
}, 60_000);

afterAll(async () => {
  if (!relais) return;
  relais.processus.kill();
  await relais.processus.exited;
});

function appele(): Relais {
  if (!relais) throw new Error('relais non démarré');
  return relais;
}

test('les deux adresses répondent, l’API refuse sans clé', async () => {
  const r = appele();
  expect((await fetch(`http://127.0.0.1:${r.web1}/api/etat`)).status).toBe(401);
  expect((await fetch(`http://127.0.0.1:${r.web2}/api/etat`)).status).toBe(401);
});

test('le lien des postes écoute sur son port, à part de l’API', async () => {
  const r = appele();
  expect((await fetch(`http://127.0.0.1:${r.postes}/poste`)).status).toBe(401);
  expect((await fetch(`http://127.0.0.1:${r.web1}/poste`)).status).not.toBe(401);
});

test('aucun tunnel SSH : le relais n’a aucun processus enfant', async () => {
  const r = appele();
  expect(await enfantsDe(r.processus.pid)).toBe('');
});

test('appairage : code de la CLI → clé d’appareil → accès accepté, sans clé refusé, code à usage unique', async () => {
  const r = appele();
  const code = (await lancer(['appairer'], r.env)).split('\n')[0]?.trim() ?? '';
  expect(code).toMatch(CODE_CLE);
  const echange = await fetch(`http://127.0.0.1:${r.web2}/api/appareils/appairer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: 'essai-appairage' }),
  });
  expect(echange.status).toBe(200);
  const { cle } = (await echange.json()) as { cle: string };
  for (const port of [r.web1, r.web2]) {
    const avec = await fetch(`http://127.0.0.1:${port}/api/etat`, { headers: { authorization: `Bearer ${cle}` } });
    expect(avec.status).toBe(200);
  }
  const rejoue = await fetch(`http://127.0.0.1:${r.web1}/api/appareils/appairer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: 'rejeu' }),
  });
  expect(rejoue.status).toBe(401);
});

test('jeton de poste : la CLI rend la configuration du poste avec son secret (le relais le lit au redémarrage)', async () => {
  const r = appele();
  const sortie = await lancer(['jeton-poste', 'essai-poste', `ws://127.0.0.1:${r.postes}/poste`], r.env);
  expect(sortie).toContain('CCREMOTE_SECRET_POSTE=');
  expect(sortie).toContain('essai-poste');
});
