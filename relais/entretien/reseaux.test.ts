// Responsabilité : tests du stockage des réseaux connus (aller-retour, droits 0600, pas d'écriture inutile).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { ReseauxConnus } from './reseaux.ts';

const JOURNAL = { warn: () => undefined } as unknown as Logger;

describe('réseaux connus des machines', () => {
  test('retenu, relu après redémarrage, droits 0600 ; inconnu → null', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'reseaux-'));
    const chemin = join(dossier, 'reveil.json');
    try {
      const a = new ReseauxConnus(chemin, JOURNAL);
      expect(a.de('tour')).toBeNull();
      a.retenir('tour', { mac: 'aa:bb:cc:dd:ee:ff', diffusion: '192.0.2.255' });
      expect(statSync(chemin).mode & 0o777).toBe(0o600);
      const b = new ReseauxConnus(chemin, JOURNAL);
      expect(b.de('tour')).toEqual({ mac: 'aa:bb:cc:dd:ee:ff', diffusion: '192.0.2.255' });
      expect(b.ids()).toEqual(['tour']);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('un fichier abîmé repart vide, sans lever d’erreur', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'reseaux-bad-'));
    const chemin = join(dossier, 'reveil.json');
    try {
      Bun.write(chemin, '{"tour": 42}');
      expect(new ReseauxConnus(chemin, JOURNAL).ids()).toEqual([]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
