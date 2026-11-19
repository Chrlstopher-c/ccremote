import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiver, fichiersPoste, preparerDossier, scriptInstallation, UNITE_POSTE } from './installer.ts';

const SECRET = 'a'.repeat(64);

describe('installation du poste', () => {
  test('le script ne contient jamais le secret, ni la clé', () => {
    const script = scriptInstallation('vps-test');
    expect(script).not.toContain(SECRET);
    expect(script).toContain(UNITE_POSTE);
    expect(script).toContain('systemctl --user restart');
    expect(script).toContain('"$BUN" install --frozen-lockfile --production');
  });

  test('la configuration du poste porte le secret dans l’env (600), pas dans le JSON', () => {
    const f = fichiersPoste('vps-test', 'Essai', 'ws://relais.exemple.test:8721/poste', SECRET);
    expect(f.posteEnv).toBe(`CCREMOTE_SECRET_POSTE=${SECRET}\n`);
    expect(f.posteJson).not.toContain(SECRET);
    const config = JSON.parse(f.posteJson) as { machine: string; relais: string; racines: string[] };
    expect(config.machine).toBe('vps-test');
    expect(config.relais).toBe('ws://relais.exemple.test:8721/poste');
    expect(config.racines).toEqual(['~']);
  });

  test('avec une API : URL et jeton dans l’env du poste, jamais dans le JSON', () => {
    const f = fichiersPoste('vps-test', '', 'ws://h/poste', SECRET, { url: 'http://h:8766', jeton: 'JETON' });
    expect(f.posteEnv).toContain('CCREMOTE_URL_API=http://h:8766\nCCREMOTE_JETON_API=JETON\n');
    expect(f.posteJson).not.toContain('JETON');
  });

  test('l’archive contient le code du poste et install/ ; le dossier temporaire est 700', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'code-test-'));
    for (const d of ['poste', 'commun']) mkdirSync(join(racine, d));
    writeFileSync(join(racine, 'poste', 'bin.ts'), 'export {};\n');
    writeFileSync(join(racine, 'commun', 'x.ts'), 'export {};\n');
    writeFileSync(join(racine, 'package.json'), '{}');
    writeFileSync(join(racine, 'bun.lock'), '');
    const dossier = await preparerDossier('vps-test', fichiersPoste('vps-test', '', 'ws://h/poste', SECRET));
    try {
      const archive = await archiver(racine, dossier);
      const fichier = join(dossier, 'archive.tgz');
      writeFileSync(fichier, archive);
      const liste = execFileSync('tar', ['-tzf', fichier]).toString();
      expect(liste).toContain('poste/bin.ts');
      expect(liste).toContain('commun/x.ts');
      expect(liste).toContain('install/installer.sh');
      expect(liste).toContain('install/poste.env');
    } finally {
      execFileSync('rm', ['-rf', dossier]);
    }
  });
});
