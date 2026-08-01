import { describe, expect, test } from 'bun:test';
import {
  ENTETE_MACHINE,
  LONGUEUR_MAX_MACHINE,
  entetesMachine,
  extraireMachineId,
  normaliserMachineId,
} from './identite-machine.ts';

describe('normaliserMachineId', () => {
  test('accepte un hostname réel et le met en forme canonique', () => {
    expect(normaliserMachineId('vps-e411b5c7')).toBe('vps-e411b5c7');
    expect(normaliserMachineId('  TrinityArch  ')).toBe('trinityarch');
    expect(normaliserMachineId('pi.local')).toBe('pi.local');
  });

  test('refuse ce qui ne peut pas servir de clé d identité', () => {
    expect(normaliserMachineId(null)).toBeNull();
    expect(normaliserMachineId(undefined)).toBeNull();
    expect(normaliserMachineId('')).toBeNull();
    expect(normaliserMachineId('   ')).toBeNull();
    // Un nom qui commence par un séparateur : lisible de travers dans un journal.
    expect(normaliserMachineId('-vps')).toBeNull();
  });

  test('refuse les caractères qui rendraient une identité ambiguë ou injectable', () => {
    // `☠` Ces valeurs finissent en clé de Map, en ligne de log et en colonne SQL.
    for (const hostile of ['vps/../pi', 'vps pc', 'vps\npc', "vps'; DROP", 'vps%00', 'équipe']) {
      expect(normaliserMachineId(hostile)).toBeNull();
    }
  });

  test('refuse au-delà de la longueur max au lieu de tronquer', () => {
    const limite = 'a'.repeat(LONGUEUR_MAX_MACHINE);
    expect(normaliserMachineId(limite)).toBe(limite);
    // `☠` Tronquer ferait cohabiter deux machines sous le même nom — exactement
    // la confusion que l'identité existe pour supprimer.
    expect(normaliserMachineId(`${limite}b`)).toBeNull();
  });
});

describe('transport de l identité', () => {
  test('voyage en en-tête, jamais dans l URL', () => {
    const entetes = entetesMachine('vps');
    expect(entetes[ENTETE_MACHINE]).toBe('vps');
    expect(JSON.stringify(entetes)).not.toContain('?');
  });

  test('extraireMachineId lit et normalise l en-tête entrant', () => {
    const req = new Request('http://pi/', { headers: { [ENTETE_MACHINE]: 'TrinityArch' } });
    expect(extraireMachineId(req)).toBe('trinityarch');
  });

  test('extraireMachineId rend null quand le client est trop ancien pour l envoyer', () => {
    expect(extraireMachineId(new Request('http://pi/'))).toBeNull();
  });

  test('extraireMachineId rend null sur un en-tête malformé — jamais une identité de repli', () => {
    const req = new Request('http://pi/', { headers: { [ENTETE_MACHINE]: '../autre' } });
    expect(extraireMachineId(req)).toBeNull();
  });
});
