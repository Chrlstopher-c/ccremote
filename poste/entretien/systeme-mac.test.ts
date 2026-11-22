// Responsabilité : tests de l'analyse macOS de la route par défaut (route -n get default) et du swap
// (sysctl vm.swapusage).
import { describe, expect, test } from 'bun:test';
import { echangeDeMac, interfaceParDefautMac } from './systeme-mac.ts';

const ROUTE_MAC = `   route to: default
destination: default
       mask: default
    gateway: 192.0.2.1
  interface: en0
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
`;

describe('route par défaut (macOS)', () => {
  test('nom de l’interface de la route par défaut', () => {
    expect(interfaceParDefautMac(ROUTE_MAC)).toBe('en0');
  });

  test('sortie vide ou sans interface : null', () => {
    expect(interfaceParDefautMac('')).toBeNull();
    expect(interfaceParDefautMac('route: not in table\n')).toBeNull();
  });
});

describe('swap (macOS)', () => {
  test('utilisé et total en octets, depuis vm.swapusage (Mo et Go)', () => {
    expect(echangeDeMac('total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)')).toEqual({
      utilise: 1024.5 * 1024 * 1024,
      total: 2048 * 1024 * 1024,
    });
    expect(echangeDeMac('total = 1.00G  used = 0.00M  free = 1024.00M  (encrypted)')).toEqual({
      utilise: 0,
      total: 1024 ** 3,
    });
  });

  test('sortie inattendue : null', () => {
    expect(echangeDeMac('')).toBeNull();
  });
});
