// Essai du geste root en simulation (LANTERNE_VPN_SIMULATION=1) : ni wg ni nft, ni root. Lancer : bun test deploiement
import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'lanterne-vpn-invites.sh');
const ID_A = 'a1b2c3d4e5f60718';
const ID_B = '0918273645abcdef';

interface Essai {
  readonly dossier: string;
  readonly conf: string;
  readonly wg: string;
  readonly verrou: string;
}

function nouvelEssai(plage: readonly [string, string] = ['10.0.0.20', '10.0.0.60']): Essai {
  const racine = mkdtempSync(join(tmpdir(), 'vpn-invites-root-'));
  const dossier = join(racine, 'demandes');
  mkdirSync(dossier);
  const conf = join(racine, 'vpn-invites.conf');
  writeFileSync(
    conf,
    [
      'INTERFACE=wg0',
      `PLAGE_DEBUT=${plage[0]}`,
      `PLAGE_FIN=${plage[1]}`,
      'NFT_ENSEMBLE=inet filtre invites_vpn',
      `DOSSIER=${dossier}`,
      '',
    ].join('\n'),
  );
  const wg = join(racine, 'wg0.conf');
  writeFileSync(wg, '[Interface]\nPrivateKey = inconnue\nAddress = 10.0.0.1/24\n');
  return { dossier, conf, wg, verrou: join(racine, 'verrou') };
}

async function lancer(essai: Essai, args: readonly string[] = []): Promise<{ code: number; erreur: string }> {
  const proc = Bun.spawn(['bash', SCRIPT, ...args], {
    env: {
      PATH: process.env['PATH'] ?? '',
      LANTERNE_VPN_SIMULATION: '1',
      LANTERNE_VPN_INVITES_CONF: essai.conf,
      LANTERNE_VPN_WG_CONF: essai.wg,
      LANTERNE_VPN_VERROU: essai.verrou,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  return { code, erreur: await new Response(proc.stderr).text() };
}

function deposer(essai: Essai, id: string, cle: string): void {
  writeFileSync(
    join(essai.dossier, `${id}.demande.json`),
    JSON.stringify({ id, cle, proprietaire: 'chris', le: new Date().toISOString() }),
    { mode: 0o600 },
  );
}

function reponse(essai: Essai, id: string): unknown {
  return JSON.parse(readFileSync(join(essai.dossier, `${id}.reponse.json`), 'utf8'));
}

const CLE = (): string => randomBytes(32).toString('base64');

describe('geste root des invités VPN (simulation)', () => {
  test('une demande valide : première adresse de la plage, pair ajouté, demande retirée, réponse écrite', async () => {
    const essai = nouvelEssai();
    const cle = CLE();
    deposer(essai, ID_A, cle);
    expect((await lancer(essai)).code).toBe(0);
    expect(reponse(essai, ID_A)).toEqual({ ok: true, adresse: '10.0.0.20' });
    expect(existsSync(join(essai.dossier, `${ID_A}.demande.json`))).toBe(false);
    const wg = readFileSync(essai.wg, 'utf8');
    expect(wg).toContain(`PublicKey = ${cle}\nAllowedIPs = 10.0.0.20/32`);
    expect(wg).toContain('PrivateKey = inconnue');
  });

  test('la demande suivante prend l’adresse libre suivante', async () => {
    const essai = nouvelEssai();
    deposer(essai, ID_A, CLE());
    await lancer(essai);
    deposer(essai, ID_B, CLE());
    await lancer(essai);
    expect(reponse(essai, ID_B)).toEqual({ ok: true, adresse: '10.0.0.21' });
  });

  test('clé publique invalide : refus rendu, aucun pair ajouté', async () => {
    const essai = nouvelEssai();
    deposer(essai, ID_A, 'pas-une-cle');
    await lancer(essai);
    expect(reponse(essai, ID_A)).toEqual({ ok: false, raison: 'clé publique invalide' });
    expect(readFileSync(essai.wg, 'utf8')).not.toContain('[Peer]');
  });

  test('plage épuisée : refus rendu, sans crash', async () => {
    const essai = nouvelEssai(['10.0.0.20', '10.0.0.20']);
    deposer(essai, ID_A, CLE());
    await lancer(essai);
    deposer(essai, ID_B, CLE());
    expect((await lancer(essai)).code).toBe(0);
    expect(reponse(essai, ID_B)).toEqual({ ok: false, raison: 'plage d’adresses épuisée' });
  });

  test('identifiant de demande invalide : ignorée et retirée', async () => {
    const essai = nouvelEssai();
    writeFileSync(join(essai.dossier, 'pas-un-id.demande.json'), '{}');
    await lancer(essai);
    expect(readdirSync(essai.dossier)).toEqual([]);
  });

  test('retirer une clé : son bloc disparaît, les autres pairs restent', async () => {
    const essai = nouvelEssai();
    const cleA = CLE();
    const cleB = CLE();
    deposer(essai, ID_A, cleA);
    await lancer(essai);
    deposer(essai, ID_B, cleB);
    await lancer(essai);
    expect((await lancer(essai, ['retirer', cleA])).code).toBe(0);
    const wg = readFileSync(essai.wg, 'utf8');
    expect(wg).not.toContain(cleA);
    expect(wg).toContain(`PublicKey = ${cleB}\nAllowedIPs = 10.0.0.21/32`);
    expect(wg).toContain('[Interface]');
  });

  test('retirer une clé inconnue : échec', async () => {
    const essai = nouvelEssai();
    expect((await lancer(essai, ['retirer', CLE()])).code).not.toBe(0);
  });

  test('configuration fausse (INTERFACE avec espace) : arrêt avant tout traitement', async () => {
    const essai = nouvelEssai();
    writeFileSync(essai.conf, readFileSync(essai.conf, 'utf8').replace('INTERFACE=wg0', 'INTERFACE=wg 0'));
    deposer(essai, ID_A, CLE());
    const r = await lancer(essai);
    expect(r.code).not.toBe(0);
    expect(r.erreur).toContain('INTERFACE invalide');
    expect(existsSync(join(essai.dossier, `${ID_A}.demande.json`))).toBe(true);
  });
});
