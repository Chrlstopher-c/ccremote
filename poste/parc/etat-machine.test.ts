// Responsabilité : tests de la sonde de la machine (mesure du disque robuste).
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { SondeMachine } from './etat-machine.ts';

describe('mesure du disque', () => {
  test('un dossier absent ne fait pas planter la sonde : repli sur la racine', () => {
    const sonde = new SondeMachine('/chemin/qui/n-existe/pas', pino({ level: 'silent' }));
    const etat = sonde.mesurer();
    expect(etat.disque.total).toBeGreaterThan(0);
  });
});
