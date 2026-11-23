// Route VPN des invités : un vrai aiguilleur en 127.0.0.1, un « service root » simulé (il lit la demande déposée
// et écrit la réponse comme le fera le script root). Vérifie les gardes, la configuration remise, les refus, le plafond.
import { afterEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { DemandeVpnInvite, ReponseVpnInvite } from '../../commun/aiguilleur.ts';
import { PlafondEchecs } from '../acces/plafond.ts';
import type { ConfigVpnInvites } from '../config.ts';
import { ouvrirAnnuaire } from './annuaire-base.ts';
import { Annuaire } from './annuaire.ts';
import { type Aiguilleur, creerAiguilleur } from './aiguilleur.ts';
import { executerCommande } from './commande.ts';

interface Monte {
  readonly url: string;
  readonly serveur: ReturnType<typeof Bun.serve>;
  readonly annuaire: Annuaire;
  readonly aiguilleur: Aiguilleur;
  readonly dossier: string;
}

const journal = pino({ level: 'silent' });
const CLE_SERVEUR = randomBytes(32).toString('base64');
const DELAI_ESSAI_MS = 1500;
const monte: Monte[] = [];

function configDe(dossier: string): ConfigVpnInvites {
  return { dossier, endpoint: 'vpn.example.com:51820', cleServeur: CLE_SERVEUR, adresseAiguilleur: '192.0.2.1' };
}

function monter(avecVpn: boolean, delaiVpnMs = DELAI_ESSAI_MS): Monte {
  const dossier = mkdtempSync(join(tmpdir(), 'vpn-invites-essai-'));
  const config = avecVpn ? configDe(dossier) : null;
  const annuaire = new Annuaire(ouvrirAnnuaire(':memory:'));
  const plafond = new PlafondEchecs(join(dossier, 'echecs.json'), journal);
  const aiguilleur = creerAiguilleur({ annuaire, journal, plafond, vpnInvites: config, delaiVpnMs });
  const serveur = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: aiguilleur.fetch,
    websocket: aiguilleur.websocket,
  });
  const m: Monte = { url: `http://127.0.0.1:${serveur.port}`, serveur, annuaire, aiguilleur, dossier };
  monte.push(m);
  return m;
}

async function appairer(m: Monte, genre: 'noeud' | 'appareil'): Promise<string> {
  const code = executerCommande(['appairer', 'chris'], m.annuaire).split('\n')[0] ?? '';
  const rep = await fetch(`${m.url}/api/membres/appairer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: 'tour', genre, cle: randomBytes(32).toString('base64url') }),
  });
  const { jeton } = z.object({ jeton: z.string() }).parse(await rep.json());
  return jeton;
}

function demanderVpn(m: Monte, jeton: string | null): Promise<Response> {
  const entetes: Record<string, string> = jeton ? { authorization: `Bearer ${jeton}` } : {};
  return fetch(`${m.url}/api/membres/vpn-invites`, { method: 'POST', headers: entetes });
}

/** Le service root simulé : attend une demande, la lit, puis écrit la réponse de façon atomique. */
async function servirRoot(
  dossier: string,
  reponse: { readonly ok: true; readonly adresse: string } | { readonly ok: false; readonly raison: string },
): Promise<DemandeVpnInvite> {
  for (let i = 0; i < 200; i++) {
    const fichier = readdirSync(dossier).find((n) => n.endsWith('.demande.json'));
    if (fichier) {
      const brut: unknown = JSON.parse(readFileSync(join(dossier, fichier), 'utf8'));
      const demande = DemandeVpnInvite.parse(brut);
      const temporaire = join(dossier, `.${demande.id}.rep`);
      writeFileSync(temporaire, JSON.stringify(reponse));
      renameSync(temporaire, join(dossier, `${demande.id}.reponse.json`));
      return demande;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('aucune demande déposée');
}

/** Clé publique recalculée depuis la clé privée remise : doit être celle déposée pour le service root. */
// PKCS#8 X25519 (RFC 8410) : préfixe fixe puis les 32 octets de la clé privée.
const PREFIXE_PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
function publiqueDeLaPrivee(privee: string): string {
  const der = Buffer.concat([PREFIXE_PKCS8_X25519, Buffer.from(privee, 'base64')]);
  const publique = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
  const x = publique.export({ format: 'jwk' }).x ?? '';
  return Buffer.from(x, 'base64url').toString('base64');
}

afterEach(() => {
  for (const m of monte.splice(0)) {
    m.aiguilleur.arreter();
    m.serveur.stop(true);
  }
});

describe('POST /api/membres/vpn-invites : gardes', () => {
  test('sans jeton ou jeton inconnu : 401', async () => {
    const m = monter(true);
    expect((await demanderVpn(m, null)).status).toBe(401);
    expect((await demanderVpn(m, 'faux')).status).toBe(401);
  });

  test('un appareil ne demande pas d’accès VPN : 403', async () => {
    const m = monter(true);
    const jeton = await appairer(m, 'appareil');
    expect((await demanderVpn(m, jeton)).status).toBe(403);
  });

  test('VPN des invités non configuré : 501, rien n’est déposé', async () => {
    const m = monter(false);
    const jeton = await appairer(m, 'noeud');
    const rep = await demanderVpn(m, jeton);
    expect(rep.status).toBe(501);
    expect(await rep.json()).toEqual({ erreur: 'VPN des invités non configuré' });
    expect(readdirSync(m.dossier)).toEqual([]);
  });
});

describe('POST /api/membres/vpn-invites : demande acceptée', () => {
  test('le nœud reçoit l’adresse et une configuration dont la clé privée correspond à la clé déposée', async () => {
    const m = monter(true);
    const jeton = await appairer(m, 'noeud');
    const root = servirRoot(m.dossier, { ok: true, adresse: '192.0.2.21' });
    const rep = await demanderVpn(m, jeton);
    const demande = await root;
    expect(rep.status).toBe(200);
    const corps = ReponseVpnInvite.parse(await rep.json());
    expect(corps.adresse).toBe('192.0.2.21');
    expect(demande.proprietaire).toBe('chris');
    const privee = /^PrivateKey = (\S+)$/m.exec(corps.config)?.[1] ?? '';
    expect(publiqueDeLaPrivee(privee)).toBe(demande.cle);
    expect(corps.config).toBe(
      [
        '[Interface]',
        `PrivateKey = ${privee}`,
        'Address = 192.0.2.21/32',
        '',
        '[Peer]',
        `PublicKey = ${CLE_SERVEUR}`,
        'Endpoint = vpn.example.com:51820',
        'AllowedIPs = 192.0.2.1/32',
        'PersistentKeepalive = 25',
        '',
      ].join('\n'),
    );
  });

  test('la clé privée n’est jamais déposée sur disque : le dossier est vide une fois la réponse rendue', async () => {
    const m = monter(true);
    const jeton = await appairer(m, 'noeud');
    const root = servirRoot(m.dossier, { ok: true, adresse: '192.0.2.22' });
    const rep = await demanderVpn(m, jeton);
    const demande = await root;
    const corps = ReponseVpnInvite.parse(await rep.json());
    const privee = /^PrivateKey = (\S+)$/m.exec(corps.config)?.[1] ?? '';
    expect(JSON.stringify(demande)).not.toContain(privee);
    expect(readdirSync(m.dossier)).toEqual([]);
  });

  test('refus du service root : 503 avec sa raison', async () => {
    const m = monter(true);
    const jeton = await appairer(m, 'noeud');
    const root = servirRoot(m.dossier, { ok: false, raison: 'plage épuisée' });
    const rep = await demanderVpn(m, jeton);
    await root;
    expect(rep.status).toBe(503);
    expect(await rep.json()).toEqual({ erreur: 'plage épuisée' });
  });

  test('aucune réponse dans le délai : 504, et la demande est retirée', async () => {
    const m = monter(true, 300);
    const jeton = await appairer(m, 'noeud');
    const rep = await demanderVpn(m, jeton);
    expect(rep.status).toBe(504);
    expect(readdirSync(m.dossier)).toEqual([]);
  });
});

describe('plafond de demandes en cours', () => {
  test('cinq demandes en cours pour un propriétaire : la sixième est refusée (429)', async () => {
    const m = monter(true, 1000);
    const jeton = await appairer(m, 'noeud');
    const enCours = Array.from({ length: 5 }, () => demanderVpn(m, jeton));
    await new Promise((r) => setTimeout(r, 100));
    expect((await demanderVpn(m, jeton)).status).toBe(429);
    const fins = await Promise.all(enCours);
    expect(fins.map((r) => r.status)).toEqual([504, 504, 504, 504, 504]);
  });
});
