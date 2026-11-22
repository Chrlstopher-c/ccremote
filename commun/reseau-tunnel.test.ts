// Responsabilité : tests du repérage de l'adresse du tunnel VPN sous macOS (interfaces utun*) par son sous-réseau.
import { describe, expect, test } from 'bun:test';
import { dansSousReseau, ecouteTunnelMac } from './reseau-tunnel.ts';

describe('dansSousReseau', () => {
  test('adresse dans le préfixe, hors du préfixe, CIDR invalide', () => {
    expect(dansSousReseau('198.51.100.2', '198.51.100.0/24')).toBe(true);
    expect(dansSousReseau('198.51.100.200', '198.51.100.0/25')).toBe(false);
    expect(dansSousReseau('198.51.100.2', 'pas-un-cidr')).toBe(false);
    expect(dansSousReseau('198.51.100.2', '198.51.100.0/40')).toBe(false);
  });
});

describe('ecouteTunnelMac', () => {
  const interfaces = {
    en0: [{ family: 'IPv4', address: '192.0.2.5' }],
    utun3: [{ family: 'IPv4', address: '198.51.100.2' }],
    utun5: [{ family: 'IPv4', address: '192.0.2.9' }],
  };

  test('l’adresse utun* dans le sous-réseau du tunnel, pas le nom wg*', () => {
    expect(ecouteTunnelMac(interfaces, '198.51.100.0/24')).toBe('198.51.100.2');
  });

  test('pas de sous-réseau configuré, ou aucune utun dedans : null (la boucle locale prend le relais)', () => {
    expect(ecouteTunnelMac(interfaces, null)).toBeNull();
    expect(ecouteTunnelMac(interfaces, '203.0.113.0/24')).toBeNull();
  });

  test('une interface hors utun* n’est jamais retenue, même dans le sous-réseau', () => {
    expect(ecouteTunnelMac({ en0: [{ family: 'IPv4', address: '198.51.100.7' }] }, '198.51.100.0/24')).toBeNull();
  });
});
