// Invitation : encodage et lecture du texte remis à un invité, et les refus (taille, version, champs, format).
import { describe, expect, test } from 'bun:test';
import { encoderInvitation, Invitation, lireInvitation, PREFIXE_INVITATION, TAILLE_MAX_INVITATION } from './invitation.ts';

const VPN = {
  adresse: '10.0.0.21',
  config: '[Interface]\nPrivateKey = cle\nAddress = 10.0.0.21/32\n\n[Peer]\nPublicKey = serveur\n',
};

function invitation(surcharge: Partial<Invitation> = {}): Invitation {
  return {
    v: 1,
    aiguilleur: 'http://10.0.0.1:8450',
    code: 'ABCD-EFGH',
    expireLe: '2026-11-23T10:00:00.000Z',
    chef: 'tour',
    vpn: VPN,
    ...surcharge,
  };
}

function texteDe(json: unknown): string {
  return PREFIXE_INVITATION + Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
}

describe('encoderInvitation / lireInvitation', () => {
  test('aller-retour : même contenu, préfixe, base64url sans remplissage', () => {
    const e = encoderInvitation(invitation());
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.valeur.startsWith(PREFIXE_INVITATION)).toBe(true);
    expect(e.valeur).not.toMatch(/[=+/]/);
    expect(lireInvitation(e.valeur)).toEqual({ ok: true, valeur: invitation() });
  });

  test('sans VPN (vpn null) : aller-retour identique', () => {
    const e = encoderInvitation(invitation({ vpn: null }));
    expect(e.ok && lireInvitation(e.valeur)).toEqual({ ok: true, valeur: invitation({ vpn: null }) });
  });

  test('lecture tolérante aux espaces autour du texte collé', () => {
    const e = encoderInvitation(invitation());
    expect(e.ok && lireInvitation(`  ${e.ok ? e.valeur : ''}\n`).ok).toBe(true);
  });

  test('encodage refusé au-delà de 8 000 caractères', () => {
    const grosse = 'x'.repeat(TAILLE_MAX_INVITATION);
    const e = encoderInvitation(invitation({ vpn: { adresse: '10.0.0.21', config: grosse.slice(0, 4000) } }));
    expect(e.ok).toBe(true);
    expect(encoderInvitation(invitation({ chef: 'c'.repeat(80), code: 'd'.repeat(40) })).ok).toBe(true);
    const trop = encoderInvitation(invitation({ vpn: { adresse: '10.0.0.21', config: 'é'.repeat(4000) } }));
    expect(trop).toEqual({ ok: false, raison: 'invitation trop longue' });
  });

  test('lecture refusée au-delà de 8 000 caractères', () => {
    expect(lireInvitation(PREFIXE_INVITATION + 'A'.repeat(TAILLE_MAX_INVITATION))).toEqual({
      ok: false,
      raison: 'invitation trop longue',
    });
  });

  test('version inconnue : refusée avec la version lue', () => {
    expect(lireInvitation(texteDe({ ...invitation(), v: 2 }))).toEqual({
      ok: false,
      raison: 'version d’invitation inconnue : 2',
    });
  });

  test('champs manquants ou en trop : refusés', () => {
    const { code: _code, ...sansCode } = invitation();
    expect(lireInvitation(texteDe(sansCode))).toEqual({
      ok: false,
      raison: 'invitation incomplète ou non conforme',
    });
    expect(lireInvitation(texteDe({ ...invitation(), extra: 1 })).ok).toBe(false);
    expect(lireInvitation(texteDe({ ...invitation(), aiguilleur: 'pas une url' })).ok).toBe(false);
  });

  test('texte qui n’est pas une invitation, ou mal formé : refusé', () => {
    expect(lireInvitation('bonjour').ok).toBe(false);
    expect(lireInvitation(PREFIXE_INVITATION + 'pas du base64 !').ok).toBe(false);
    expect(lireInvitation(PREFIXE_INVITATION + Buffer.from('{pas json', 'utf8').toString('base64url'))).toEqual({
      ok: false,
      raison: 'invitation mal formée',
    });
  });

  test('encodage refuse une invitation incomplète (rien n’est produit)', () => {
    expect(encoderInvitation({ ...invitation(), code: '' })).toEqual({ ok: false, raison: 'invitation incomplète ou non conforme' });
  });
});
