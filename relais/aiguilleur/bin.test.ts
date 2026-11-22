// Vrai processus : relais/bin.ts en mode aiguilleur, commande locale lancée à part. Vérifie : le relais complet n'est pas
// lancé (pas de /api, pas de base relais.db), l'appairage passe par la commande, le lien s'ouvre, et l'annuaire ne
// contient que ses quatre tables.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RACINE = join(import.meta.dir, '..', '..');
const CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;

let processus: ReturnType<typeof Bun.spawn> | null = null;
let port = 0;
let env: Record<string, string> = {};
let donnees = '';

function portLibre(): number {
  const s = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const p = s.port;
  s.stop(true);
  return p;
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
      // le serveur n'écoute pas encore
    }
    await Bun.sleep(150);
  }
  throw new Error(`pas de réponse ${statut} sur ${url}`);
}

async function commande(args: string[]): Promise<string> {
  const p = Bun.spawn([process.execPath, 'run', 'relais/aiguilleur/commande.ts', ...args], {
    cwd: RACINE,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const sortie = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`commande ${args.join(' ')} en échec`);
  return sortie;
}

beforeAll(async () => {
  donnees = mkdtempSync(join(tmpdir(), 'aiguilleur-bin-'));
  port = portLibre();
  env = environnement({
    LANTERNE_RELAIS_MODE: 'aiguilleur',
    LANTERNE_RELAIS_ECOUTE: `127.0.0.1:${port}`,
    LANTERNE_RELAIS_DONNEES: donnees,
    CCREMOTE_JOURNAL: join(donnees, 'aiguilleur.log'),
  });
  processus = Bun.spawn([process.execPath, 'run', 'relais/bin.ts'], {
    cwd: RACINE,
    env,
    stdout: 'ignore',
    stderr: Bun.file(join(donnees, 'aiguilleur.err')),
  });
  await attendre(`http://127.0.0.1:${port}/aiguilleur`, 401);
}, 60_000);

afterAll(() => {
  processus?.kill();
});

test('le binaire en mode aiguilleur : pas de relais complet, appairage par commande, lien ouvert', async () => {
  const absent = await fetch(`http://127.0.0.1:${port}/api/etat`);
  expect(absent.status).toBe(404);
  const code = (await commande(['appairer', 'chris'])).split('\n')[0]?.trim() ?? '';
  expect(code).toMatch(CODE);
  const rep = await fetch(`http://127.0.0.1:${port}/api/membres/appairer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: 'essai', genre: 'appareil', cle: 'k'.repeat(43) }),
  });
  expect(rep.status).toBe(200);
  const { jeton } = (await rep.json()) as { jeton: string };
  const lien = new WebSocket(`ws://127.0.0.1:${port}/aiguilleur`, { headers: { authorization: `Bearer ${jeton}` } });
  await new Promise<void>((ok, ko) => {
    lien.onopen = () => ok();
    lien.onerror = () => ko(new Error('lien refusé'));
  });
  lien.close();
});

test('la base du service ne contient que l’annuaire, et aucun fichier du relais complet', () => {
  const db = new Database(join(donnees, 'annuaire.db'), { readonly: true });
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  db.close();
  expect(tables.map((t) => t.name)).toEqual(['appairages', 'jetons', 'liens_duo', 'membres']);
  expect(readdirSync(donnees).filter((f) => f.startsWith('relais.db'))).toEqual([]);
});
