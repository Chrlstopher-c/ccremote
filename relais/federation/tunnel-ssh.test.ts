// Tunnel ssh tenu par le nœud : forme de la commande (hôte vérifié, clé dédiée, known_hosts du dossier), refus d'un
// champ qui ressemble à une option, relance après une chute, arrêt sans relance. La commande ssh est un faux processus
// (script shell) : aucune connexion réelle ici.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { attendre } from './banc-federation.ts';
import { argumentsTunnelSsh, TunnelSsh, type TunnelSshConfig, tunnelSshValide } from './tunnel-ssh.ts';

const journal = pino({ enabled: false });
const CONFIG: TunnelSshConfig = {
  hote: 'machine.example.com',
  port: 22,
  utilisateur: 'essai',
  cle: '/home/essai/.config/lanterne/cle_tunnel',
  portLocal: 47001,
  portDistant: 47002,
};

let dossier = '';

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'tunnel-ssh-'));
});

afterEach(() => {
  dossier = '';
});

describe('commande du tunnel', () => {
  test('redirige le port local vers le port distant, hôte et clé vérifiés', () => {
    const args = argumentsTunnelSsh(CONFIG, '/secrets/known_hosts');
    expect(args).toContain('127.0.0.1:47001:127.0.0.1:47002');
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).toContain('UserKnownHostsFile=/secrets/known_hosts');
    expect(args).toContain('BatchMode=yes');
    expect(args.at(-1)).toBe('essai@machine.example.com');
  });

  test('un champ qui ressemble à une option, ou une clé relative, est refusé', () => {
    expect(tunnelSshValide({ ...CONFIG, hote: '-oProxyCommand=sh' })).toBe(false);
    expect(tunnelSshValide({ ...CONFIG, utilisateur: '-x' })).toBe(false);
    expect(tunnelSshValide({ ...CONFIG, cle: 'cle_relative' })).toBe(false);
    expect(tunnelSshValide({ ...CONFIG, portLocal: 70000 })).toBe(false);
    expect(tunnelSshValide(CONFIG)).toBe(true);
  });
});

describe('cycle de vie', () => {
  test('une chute relance le tunnel ; l’arrêt le coupe sans relance', async () => {
    const trace = join(dossier, 'lancements.txt');
    const faux = join(dossier, 'faux-ssh');
    writeFileSync(faux, `#!/bin/sh\necho lance >> "${trace}"\nsleep 0.1\n`);
    chmodSync(faux, 0o755);
    const tunnel = new TunnelSsh(CONFIG, {
      commande: faux,
      knownHosts: join(dossier, 'known_hosts'),
      journal,
      delaiRelanceMs: 50,
    });
    tunnel.demarrer();
    const lancements = (): number => (existsSync(trace) ? readFileSync(trace, 'utf8').split('\n').filter(Boolean).length : 0);
    await attendre(() => lancements() >= 3, 6000);
    tunnel.arreter();
    const apres = lancements();
    await Bun.sleep(400);
    expect(lancements()).toBe(apres);
    expect(tunnel.actif).toBe(false);
    expect(tunnel.adresseLocale).toBe('127.0.0.1:47001');
  });
});
