// Responsabilité : tests de la commande de lancement d'un serveur de module selon la plateforme (systemd-run sous Linux,
// nice seul sous macOS, qui n'a pas de bus systemd ni de limite de mémoire par processus).
import { describe, expect, test } from 'bun:test';
import { commandeSysteme } from './lancement.ts';

describe('commandeSysteme', () => {
  test('Linux : systemd-run borné en mémoire et CPU, puis nice et bun (inchangé)', () => {
    expect(commandeSysteme('/m/serveur/index.ts', 'linux')).toEqual([
      'systemd-run', '--user', '--scope', '-q', '-p', 'MemoryMax=1G', '-p', 'CPUQuota=100%', '--',
      'nice', '-n', '10', 'bun', 'run', '/m/serveur/index.ts',
    ]);
  });

  test('macOS : nice puis bun, sans systemd-run', () => {
    expect(commandeSysteme('/m/serveur/index.ts', 'darwin')).toEqual([
      'nice', '-n', '10', 'bun', 'run', '/m/serveur/index.ts',
    ]);
  });
});
