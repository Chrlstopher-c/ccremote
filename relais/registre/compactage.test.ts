import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIGNE_PATIENCE, compacterPeu, ouvrirBase } from './base.ts';

const pragma = (db: ReturnType<typeof ouvrirBase>, nom: string): number =>
  Object.values(db.query(`PRAGMA ${nom}`).get() as Record<string, number>)[0] ?? -1;

describe('compactage de la base', () => {
  test('une base neuve est en compactage continu', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'base-'));
    const db = ouvrirBase(join(dossier, 'r.db'));
    expect(pragma(db, 'auto_vacuum')).toBe(2);
    compacterPeu(db);
    db.close();
    rmSync(dossier, { recursive: true });
  });

  test('une ancienne base surtout vide est compactée une fois, avec la ligne de patience', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'base-'));
    const chemin = join(dossier, 'r.db');
    const ancienne = ouvrirBase(chemin);
    ancienne.exec('PRAGMA auto_vacuum = NONE; VACUUM;');
    ancienne.exec("CREATE TABLE remplissage (x TEXT); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 30000) INSERT INTO remplissage SELECT hex(randomblob(4000)) FROM n; DELETE FROM remplissage;");
    expect(pragma(ancienne, 'freelist_count')).toBeGreaterThan(25_000);
    ancienne.close();
    const sortie = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const db = ouvrirBase(chemin);
    expect(sortie.mock.calls.some(([l]) => String(l).startsWith(`${LIGNE_PATIENCE} `))).toBe(true);
    sortie.mockRestore();
    expect(pragma(db, 'freelist_count')).toBeLessThan(100);
    expect(pragma(db, 'auto_vacuum')).toBe(2);
    db.close();
    rmSync(dossier, { recursive: true });
  });
});
