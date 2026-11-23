import { describe, expect, test } from 'bun:test';
import { chargerConfigAiguilleur } from '../config.ts';

const BASE = { LANTERNE_RELAIS_MODE: 'aiguilleur', LANTERNE_RELAIS_ECOUTE: '127.0.0.1:8080,127.0.0.2:8081' };

describe('configuration de l’aiguilleur', () => {
  test('écoute et données lues dans l’environnement ; base à part dans le dossier de données', () => {
    const c = chargerConfigAiguilleur({ ...BASE, LANTERNE_RELAIS_DONNEES: '/donnees/aiguilleur' });
    expect(c.ecouteWeb).toEqual([
      { hote: '127.0.0.1', port: 8080 },
      { hote: '127.0.0.2', port: 8081 },
    ]);
    expect(c.base).toBe('/donnees/aiguilleur/annuaire.db');
    expect(c.fichierEchecs).toBe('/donnees/aiguilleur/echecs-membres.json');
  });

  test('sans dossier de données ou sans écoute, la configuration est refusée au démarrage', () => {
    expect(() => chargerConfigAiguilleur({ ...BASE })).toThrow(/LANTERNE_RELAIS_DONNEES/);
    expect(() =>
      chargerConfigAiguilleur({ LANTERNE_RELAIS_MODE: 'aiguilleur', LANTERNE_RELAIS_DONNEES: '/d' }),
    ).toThrow(/LANTERNE_RELAIS_ECOUTE/);
  });

  test('VPN des invités : absent tant qu’une variable manque ; valeurs fausses refusées au démarrage', () => {
    const cle = 'A'.repeat(43) + '=';
    const vpn = {
      LANTERNE_VPN_INVITES_DOSSIER: '/donnees/vpn',
      LANTERNE_VPN_ENDPOINT: 'vpn.example.com:51820',
      LANTERNE_VPN_CLE_SERVEUR: cle,
      LANTERNE_VPN_ADRESSE_AIGUILLEUR: '10.0.0.1',
    };
    expect(chargerConfigAiguilleur({ ...BASE, LANTERNE_RELAIS_DONNEES: '/d' }).vpnInvites).toBeNull();
    const complete = chargerConfigAiguilleur({ ...BASE, LANTERNE_RELAIS_DONNEES: '/d', ...vpn });
    expect(complete.vpnInvites).toEqual({
      dossier: '/donnees/vpn',
      endpoint: 'vpn.example.com:51820',
      cleServeur: cle,
      adresseAiguilleur: '10.0.0.1',
    });
    const avec = (cle2: string, valeur: string) => ({ ...BASE, LANTERNE_RELAIS_DONNEES: '/d', ...vpn, [cle2]: valeur });
    expect(() => chargerConfigAiguilleur(avec('LANTERNE_VPN_ENDPOINT', 'vpn example.com'))).toThrow(/ENDPOINT/);
    expect(() => chargerConfigAiguilleur(avec('LANTERNE_VPN_CLE_SERVEUR', 'trop court'))).toThrow(/CLE_SERVEUR/);
    const injection = '10.0.0.1\n[Peer]';
    expect(() => chargerConfigAiguilleur(avec('LANTERNE_VPN_ADRESSE_AIGUILLEUR', injection))).toThrow(/ADRESSE/);
    expect(() => chargerConfigAiguilleur(avec('LANTERNE_VPN_INVITES_DOSSIER', 'relatif'))).toThrow(/DOSSIER/);
  });
});
