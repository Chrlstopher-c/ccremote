// Invitation tout-en-un du nœud : un vrai CodesReseau relié à un aiguilleur simulé en HTTP (127.0.0.1). Vérifie le
// contenu du texte remis, les refus (VPN non configuré, service root en échec), le jeton transmis, et l'absence de
// code et de configuration dans les journaux.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { lireInvitation } from '../../commun/invitation.ts';
import { CodesReseau } from '../codes-reseau/codes-reseau.ts';
import { SecretsNoeud } from '../federation/secrets.ts';
import { creerInvitation } from './invitation.ts';

const JETON = 'jeton-de-test-0123456789';
const PRIVEE = 'PRIVEE-DE-TEST-' + 'x'.repeat(28);

type ModeVpn = 'ok' | 'non-configure' | 'plage-epuisee';

let serveur: ReturnType<typeof Bun.serve> | null = null;
let mode: ModeVpn = 'ok';
const lignes: string[] = [];
const journal = pino({ level: 'trace' }, { write: (s: string) => void lignes.push(s) });

function reponseVpn(): Response {
  if (mode === 'non-configure') return Response.json({ erreur: 'VPN des invités non configuré' }, { status: 501 });
  if (mode === 'plage-epuisee') return Response.json({ erreur: 'plage d’adresses épuisée' }, { status: 503 });
  const config = `[Interface]\nPrivateKey = ${PRIVEE}\nAddress = 192.0.2.21/32\n\n[Peer]\nPublicKey = serveur\n`;
  return Response.json({ adresse: '192.0.2.21', config });
}

function demarrerAiguilleur(): string {
  serveur = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (req) => {
      const entete = req.headers.get('authorization') ?? '';
      const route = new URL(req.url).pathname;
      if (entete !== `Bearer ${JETON}`) return Response.json({}, { status: 401 });
      if (route === '/api/membres/codes') {
        return Response.json({ code: 'ABCD-EFGH', expireLe: '2026-11-23T10:00:00.000Z' });
      }
      if (route === '/api/membres/vpn-invites') return reponseVpn();
      return Response.json({}, { status: 404 });
    },
  });
  return `http://127.0.0.1:${serveur.port}`;
}

function nouveauCodes(relie: boolean, jeton = JETON): CodesReseau {
  const dossier = mkdtempSync(join(tmpdir(), 'invitation-noeud-'));
  const secrets = new SecretsNoeud(dossier, journal);
  if (relie) {
    secrets.ecrireAiguilleur({
      url: demarrerAiguilleur(),
      jeton,
      id: 'aaaaaaaaaaaa',
      nom: 'tour',
      proprietaire: 'chris',
    });
  }
  return new CodesReseau(secrets, journal);
}

beforeEach(() => {
  mode = 'ok';
  lignes.length = 0;
});

afterEach(() => {
  serveur?.stop(true);
  serveur = null;
});

describe('invitation tout-en-un du nœud', () => {
  test('VPN attribué : le texte porte aiguilleur, code, chef, adresse et configuration', async () => {
    const r = await creerInvitation(nouveauCodes(true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lue = lireInvitation(r.valeur.invitation);
    expect(lue.ok).toBe(true);
    if (!lue.ok) return;
    expect(lue.valeur).toMatchObject({
      v: 1,
      aiguilleur: serveur ? `http://127.0.0.1:${serveur.port}` : '',
      code: 'ABCD-EFGH',
      expireLe: '2026-11-23T10:00:00.000Z',
      chef: 'tour',
      vpn: { adresse: '192.0.2.21' },
    });
    expect(lue.valeur.vpn?.config).toContain(`PrivateKey = ${PRIVEE}`);
    expect(r.valeur.code).toBe('ABCD-EFGH');
    expect(r.valeur.vpn).toEqual({ adresse: '192.0.2.21' });
  });

  test('aucun journal ne contient le code, ni la clé privée', async () => {
    await creerInvitation(nouveauCodes(true));
    const trace = lignes.join('\n');
    expect(trace).not.toContain('ABCD-EFGH');
    expect(trace).not.toContain(PRIVEE);
  });

  test('VPN non configuré chez l’aiguilleur (501) : invitation sans VPN, vpn null', async () => {
    mode = 'non-configure';
    const r = await creerInvitation(nouveauCodes(true));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeur.vpn).toBeNull();
    expect(lireInvitation(r.valeur.invitation)).toMatchObject({ ok: true, valeur: { vpn: null, code: 'ABCD-EFGH' } });
  });

  test('échec du service VPN (503) : l’invitation échoue avec la raison de l’aiguilleur', async () => {
    mode = 'plage-epuisee';
    const r = await creerInvitation(nouveauCodes(true));
    expect(r).toEqual({ ok: false, statut: 503, raison: 'plage d’adresses épuisée' });
  });

  test('nœud non relié : 409, rien n’est demandé', async () => {
    const r = await creerInvitation(nouveauCodes(false));
    expect(r).toEqual({ ok: false, statut: 409, raison: 'nœud non relié à un aiguilleur' });
  });

  test('jeton refusé par l’aiguilleur : invitation refusée (409, nœud plus reconnu), rien n’est remis', async () => {
    const r = await creerInvitation(nouveauCodes(true, 'mauvais-jeton-0123456789'));
    expect(r).toEqual({ ok: false, statut: 409, raison: 'ce nœud n’est plus reconnu par l’aiguilleur' });
  });
});
