// Responsabilité : tests de l'analyse réseau (route par défaut, diffusion) et de l'échange, sur des textes réels.
import { describe, expect, test } from 'bun:test';
import type { NetworkInterfaceInfo } from 'node:os';
import { diffusionDe, echangeDe, interfaceParDefaut, reseauDe } from './systeme.ts';

const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
enp3s0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t00\t0\t0
enp3s0\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t00\t0\t0
`;

function info(nom: string, mac: string, address: string, netmask: string): NodeJS.Dict<NetworkInterfaceInfo[]> {
  return {
    [nom]: [
      {
        address,
        netmask,
        family: 'IPv4',
        mac,
        internal: false,
        cidr: `${address}/24`,
        scopeid: -1,
      } as NetworkInterfaceInfo,
    ],
  };
}

describe('réseau', () => {
  test('interface de la route par défaut (destination et masque nuls)', () => {
    expect(interfaceParDefaut(ROUTE)).toBe('enp3s0');
    expect(interfaceParDefaut('Iface\tDestination\n')).toBeNull();
  });

  test('diffusion calculée depuis adresse et masque', () => {
    expect(diffusionDe('192.0.2.10', '255.255.255.0')).toBe('192.0.2.255');
    expect(diffusionDe('10.1.2.3', '255.255.0.0')).toBe('10.1.255.255');
    expect(diffusionDe('x', '255.255.255.0')).toBeNull();
  });

  test('MAC et diffusion de l’interface par défaut ; sans MAC ou sans route : null', () => {
    expect(reseauDe(ROUTE, info('enp3s0', 'aa:bb:cc:dd:ee:ff', '192.0.2.10', '255.255.255.0'))).toEqual({
      mac: 'aa:bb:cc:dd:ee:ff',
      diffusion: '192.0.2.255',
    });
    expect(reseauDe(ROUTE, info('enp3s0', '00:00:00:00:00:00', '192.0.2.10', '255.255.255.0'))).toBeNull();
    expect(
      reseauDe('Iface\tDestination\n', info('enp3s0', 'aa:bb:cc:dd:ee:ff', '192.0.2.10', '255.255.255.0')),
    ).toBeNull();
  });
});

describe('échange', () => {
  test('swap utilisé = total − libre, en octets', () => {
    expect(echangeDe('MemTotal: 1 kB\nSwapTotal:    2048 kB\nSwapFree:     1024 kB\n')).toEqual({
      utilise: 1024 * 1024,
      total: 2048 * 1024,
    });
  });

  test('pas de champ swap (hors Linux) : null', () => {
    expect(echangeDe('MemTotal: 1 kB\n')).toBeNull();
  });
});
