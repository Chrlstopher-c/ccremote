// Responsabilité : tests du réveil Wake-on-LAN — paquet magique, banc (réveil factice écrit dans un fichier).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { enregistrerReveilFactice, envoyerReveil, paquetMagique } from './reveil.ts';

const JOURNAL_MUET = { warn: () => undefined } as unknown as Logger;

describe('paquet magique', () => {
  test('102 octets : six 0xFF puis seize répétitions de la MAC', () => {
    const p = paquetMagique('aa:bb:cc:dd:ee:ff');
    expect(p.length).toBe(102);
    expect(p.subarray(0, 6).every((o) => o === 0xff)).toBe(true);
    expect(p.subarray(6, 12).toString('hex')).toBe('aabbccddeeff');
  });

  test('MAC invalide refusée', () => {
    expect(() => paquetMagique('aa:bb:cc')).toThrow();
  });
});

describe('banc : réveil factice', () => {
  test('chaque réveil ajoute une ligne JSON au fichier, sans envoi', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'reveil-banc-'));
    const fichier = join(dossier, 'factice.jsonl');
    try {
      await envoyerReveil({ mac: 'aa:bb:cc:dd:ee:ff', diffusion: '192.0.2.255', par: 'relais' }, fichier, JOURNAL_MUET);
      enregistrerReveilFactice(fichier, { mac: 'aa:bb:cc:dd:ee:ff', diffusion: '192.0.2.255', par: 'poste-x' }, 'T');
      const lignes = readFileSync(fichier, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, string>);
      expect(lignes).toHaveLength(2);
      expect(lignes[0]?.['par']).toBe('relais');
      expect(lignes[1]).toEqual({ ts: 'T', mac: 'aa:bb:cc:dd:ee:ff', diffusion: '192.0.2.255', par: 'poste-x' });
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
