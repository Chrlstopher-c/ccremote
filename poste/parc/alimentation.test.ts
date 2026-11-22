// Responsabilité : tests de la commande d'extinction par plateforme (systemctl sous Linux, osascript sous macOS).
import { describe, expect, test } from 'bun:test';
import { commandeExtinction } from './alimentation.ts';

describe('commandeExtinction', () => {
  test('Linux : systemctl poweroff (inchangé)', () => {
    expect(commandeExtinction('linux')).toEqual(['systemctl', 'poweroff']);
  });

  test('macOS : arrêt demandé à Finder via osascript, sans sudo', () => {
    expect(commandeExtinction('darwin')).toEqual(['osascript', '-e', 'tell application "System Events" to shut down']);
  });
});
