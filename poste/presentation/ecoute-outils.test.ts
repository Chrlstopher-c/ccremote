// Responsabilité : tests de l'écoute des outils hors Lanterne — socket Unix 0600, liste blanche (deux opérations),
// ligne bornée, session forcée à null pour module_appeler, socket périmée remplacée, arrêt propre.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';
import { demarrerEcouteOutils, type EcouteOutils, type RelaisOutils } from './ecoute-outils.ts';
import { TAILLE_MAX_LIGNE_OUTILS } from './socket-outils.ts';

const journal = pino({ level: 'silent' });
const ouverts: EcouteOutils[] = [];
const dossiers: string[] = [];

afterEach(() => {
  for (const e of ouverts.splice(0)) e.arreter();
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

function banc(reponse: ReponseRelais = { ok: true, donnees: { modules: [] } }) {
  const dossier = mkdtempSync(join(tmpdir(), 'ecoute-outils-'));
  dossiers.push(dossier);
  const chemin = join(dossier, 'outils.sock');
  const appels: { quoi: QuoiRelais; args: unknown }[] = [];
  const relais: RelaisOutils = async (quoi, args) => {
    appels.push({ quoi, args });
    return reponse;
  };
  const ecoute = demarrerEcouteOutils({ chemin, relais, journal });
  ouverts.push(ecoute);
  return { chemin, appels, ecoute };
}

/** Envoie des lignes sur le socket et rend les lignes de réponse reçues (à la fermeture ou au délai). */
function dialoguer(chemin: string, lignes: string[], attendues: number): Promise<string[]> {
  return new Promise((resoudre) => {
    const recues: string[] = [];
    let tampon = '';
    const s = createConnection(chemin);
    const fin = (): void => {
      clearTimeout(garde);
      s.destroy();
      resoudre(recues);
    };
    const garde = setTimeout(fin, 3000);
    s.on('connect', () => s.write(lignes.map((l) => `${l}\n`).join('')));
    s.on('data', (octets) => {
      tampon += octets.toString('utf8');
      const morceaux = tampon.split('\n');
      tampon = morceaux.pop() ?? '';
      recues.push(...morceaux.filter((m) => m !== ''));
      if (recues.length >= attendues) fin();
    });
    s.on('close', fin);
    s.on('error', fin);
  });
}

/** Un processus qui écoute puis meurt sans nettoyer : laisse un fichier socket périmé (arrêt par PID numérique). */
async function laisserSocketPerimee(chemin: string): Promise<void> {
  const code = 'Bun.listen({ unix: process.env.SOCKET_PERIME, socket: { data() {} } }); setInterval(() => {}, 1000);';
  const proc = Bun.spawn([process.execPath, '-e', code], {
    env: { ...process.env, SOCKET_PERIME: chemin },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const limite = Date.now() + 5000;
  while (!existsSync(chemin) && Date.now() < limite) await new Promise((r) => setTimeout(r, 20));
  process.kill(proc.pid, 'SIGKILL');
  await proc.exited;
}

describe('écoute des outils hors Lanterne', () => {
  test('socket créé en 0600, requête valide relayée, réponse rendue avec son id', async () => {
    const { chemin, appels } = banc({ ok: true, donnees: { modules: [{ module: 'carte' }] } });
    expect(statSync(chemin).mode & 0o777).toBe(0o600);
    const [reponse] = await dialoguer(chemin, [JSON.stringify({ id: 'a1', quoi: 'modules_lister', args: {} })], 1);
    expect(JSON.parse(reponse ?? 'null')).toEqual({ id: 'a1', ok: true, donnees: { modules: [{ module: 'carte' }] } });
    expect(appels).toEqual([{ quoi: 'modules_lister', args: {} }]);
  });

  test('module_appeler : la session transmise est forcée à null, les autres arguments passent', async () => {
    const { chemin, appels } = banc();
    const demande = { id: 'b1', quoi: 'module_appeler', args: { module: 'carte', outil: 'centrer', session: 'x-1' } };
    await dialoguer(chemin, [JSON.stringify(demande)], 1);
    expect(appels).toEqual([{ quoi: 'module_appeler', args: { module: 'carte', outil: 'centrer', session: null } }]);
  });

  test('opération hors liste refusée sans être relayée', async () => {
    const { chemin, appels } = banc();
    const lignes = [
      JSON.stringify({ id: 'c1', quoi: 'module_afficher', args: {} }),
      JSON.stringify({ id: 'c2', quoi: 'renommer_conversation' }),
    ];
    const [premiere, seconde] = await dialoguer(chemin, lignes, 2);
    expect(JSON.parse(premiere ?? 'null')).toMatchObject({ id: 'c1', ok: false });
    expect(JSON.parse(seconde ?? 'null')).toMatchObject({ id: 'c2', ok: false });
    expect(appels).toEqual([]);
  });

  test('ligne trop longue refusée, connexion fermée', async () => {
    const { chemin, appels } = banc();
    const trop = JSON.stringify({ id: 'd1', quoi: 'modules_lister', args: { x: 'y'.repeat(TAILLE_MAX_LIGNE_OUTILS) } });
    const [reponse] = await dialoguer(chemin, [trop], 1);
    expect(JSON.parse(reponse ?? 'null')).toMatchObject({ id: null, ok: false });
    expect(appels).toEqual([]);
  });

  test('socket périmée d’un lancement précédent remplacée', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'ecoute-outils-perime-'));
    dossiers.push(dossier);
    const chemin = join(dossier, 'outils.sock');
    await laisserSocketPerimee(chemin);
    expect(existsSync(chemin)).toBe(true);
    const ecoute = demarrerEcouteOutils({ chemin, relais: async () => ({ ok: true }), journal });
    ouverts.push(ecoute);
    const [reponse] = await dialoguer(chemin, [JSON.stringify({ id: 'e1', quoi: 'modules_lister', args: {} })], 1);
    expect(JSON.parse(reponse ?? 'null')).toMatchObject({ id: 'e1', ok: true });
  });

  test('un fichier ordinaire à la place du socket n’est jamais effacé', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'ecoute-outils-fichier-'));
    dossiers.push(dossier);
    const chemin = join(dossier, 'outils.sock');
    writeFileSync(chemin, 'pas un socket');
    expect(() => demarrerEcouteOutils({ chemin, relais: async () => ({ ok: true }), journal })).toThrow();
    expect(existsSync(chemin)).toBe(true);
  });

  test('arrêt propre : le socket est retiré', () => {
    const { chemin, ecoute } = banc();
    ecoute.arreter();
    expect(existsSync(chemin)).toBe(false);
  });
});
