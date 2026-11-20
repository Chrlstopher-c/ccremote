// Responsabilité : tests de la lecture des suivis d'agents sur disque (lecture seule, tri, tailles, fichiers abîmés).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { dossierChantiers, lireChantiers, MAX_OCTETS } from './chantiers.ts';

const JOURNAL = { warn: () => undefined, debug: () => undefined } as unknown as Logger;

function fichier(dossier: string, nom: string, contenu: string, mtimeSec: number): void {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, contenu);
  utimesSync(chemin, mtimeSec, mtimeSec);
}

describe('lecture des chantiers', () => {
  test('dossier absent : aucun chantier, pas d’erreur', () => {
    expect(lireChantiers('/chemin/qui/n-existe-pas/xyz', JOURNAL)).toEqual([]);
  });

  test('seuls les .json comptent ; un JSON cassé et un fichier trop gros sont ignorés ; tri en cours d’abord', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'chantiers-'));
    try {
      fichier(
        dossier,
        'ancien.json',
        JSON.stringify({ agent: 'a', statut: 'termine', mission: 'vieux' }),
        1_700_000_000,
      );
      fichier(
        dossier,
        'actif.json',
        JSON.stringify({ agent: 'b', statut: 'en cours', mission: 'neuf' }),
        1_700_000_500,
      );
      fichier(dossier, 'casse.json', '{pas du json', 1_700_000_600);
      fichier(dossier, 'notes.txt', 'ignoré', 1_700_000_700);
      fichier(dossier, 'gros.json', 'x'.repeat(MAX_OCTETS + 1), 1_700_000_800);
      const lus = lireChantiers(dossier, JOURNAL);
      expect(lus.map((c) => c.mission)).toEqual(['neuf', 'vieux']);
      expect(lus[0]?.statut).toBe('en_cours');
      expect(lus[0]?.majLe).toBe(new Date(1_700_000_500 * 1000).toISOString());
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('la lecture ne modifie jamais le dossier', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'chantiers-ro-'));
    try {
      mkdirSync(join(dossier, 'sous'));
      fichier(dossier, 'a.json', JSON.stringify({ statut: 'done', titre: 'T' }), 1_700_000_000);
      const avant = readdirSync(dossier).sort().join(',');
      lireChantiers(dossier, JOURNAL);
      expect(readdirSync(dossier).sort().join(',')).toBe(avant);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

describe('dossier des chantiers', () => {
  test('variable d’environnement, sinon ~/.local/state/chantier', () => {
    expect(dossierChantiers({ LANTERNE_DOSSIER_CHANTIERS: '/banc/chantiers' } as NodeJS.ProcessEnv)).toBe(
      '/banc/chantiers',
    );
    expect(dossierChantiers({} as NodeJS.ProcessEnv).endsWith(join('.local', 'state', 'chantier'))).toBe(true);
  });
});
