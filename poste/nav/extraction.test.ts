// Responsabilité : tests de l'extraction de la CLI noctis-nav hors du binaire compilé — détection, lanceurs sh et cmd,
// écriture qui ne réécrit que ce qui diffère, lanceur extrait qui fonctionne, repli sans CLI quand l'extraction échoue.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ecrireNav, fichiersNav, lanceurUnix, lanceurWindows, preparerNav } from './extraction.ts';
import { executerSousCommandeNav } from './sous-commande.ts';
import { DOSSIER_NAV, dossierNav, enBinaire, environnementNav, fixerDossierNav } from './environnement.ts';
import { SOURCES_NAV } from './embarque.ts';

const journal = pino({ level: 'silent' });
const dossiers: string[] = [];

function dossierTemporaire(): string {
  const d = mkdtempSync(join(tmpdir(), 'nav-extraction-'));
  dossiers.push(d);
  return d;
}

afterEach(() => {
  fixerDossierNav(DOSSIER_NAV);
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('détection du binaire compilé', () => {
  test('sous Linux (/$bunfs) et sous Windows (~BUN) : binaire ; un dossier source : non', () => {
    expect(enBinaire('/$bunfs/root')).toBe(true);
    expect(enBinaire('B:\\~BUN\\root')).toBe(true);
    expect(enBinaire('/mnt/projects/wt-nav-quart/poste/nav')).toBe(false);
    expect(enBinaire('/home/x/~BUNa')).toBe(false);
  });
});

describe('lanceurs', () => {
  test('sh : node d’abord, puis le binaire du poste avec la sous-commande nav, chemin protégé', () => {
    const t = lanceurUnix("/opt/lanterne moteur/it's", '/d/nav');
    expect(t.startsWith('#!/bin/sh\n')).toBe(true);
    expect(t).toContain('exec node "$DIR/entree.mjs" "$@"');
    expect(t).toContain(`exec '/opt/lanterne moteur/it'\\''s' nav '/d/nav' "$@"`);
  });

  test('cmd : en CRLF, node si présent, sinon le binaire avec nav', () => {
    const t = lanceurWindows('C:\\Noctis\\lanterne-moteur.exe', 'C:\\d\\nav');
    expect(t).toContain('node "%~dp0entree.mjs" %*');
    expect(t).toContain('"C:\\Noctis\\lanterne-moteur.exe" nav "C:\\d\\nav" %*');
    expect(t.split('\n').every((l, i, tous) => i === tous.length - 1 || l.endsWith('\r'))).toBe(true);
  });

  test('fichiers : sources embarquées et un seul lanceur, selon la plateforme', () => {
    const sh = fichiersNav('/bin/x', '/d', false);
    expect(Object.keys(sh.fichiers).sort()).toEqual(['cli.mjs', 'client.mjs', 'entree.mjs', 'noctis-nav']);
    expect(sh.lanceur).toBe('noctis-nav');
    expect(fichiersNav('C:\\x.exe', 'C:\\d', true).lanceur).toBe('noctis-nav.cmd');
  });

  test('les sources embarquées sont celles du dépôt', () => {
    expect(SOURCES_NAV['cli.mjs']).toContain('executerCli');
    expect(SOURCES_NAV['client.mjs']).toContain('export const nav');
  });
});

describe('écriture', () => {
  test('crée les fichiers, lanceur exécutable (0755)', () => {
    const d = dossierTemporaire();
    const { fichiers, lanceur } = fichiersNav('/bin/x', join(d, 'nav'), false);
    ecrireNav(join(d, 'nav'), fichiers, lanceur);
    expect(readFileSync(join(d, 'nav', 'cli.mjs'), 'utf8')).toBe(SOURCES_NAV['cli.mjs'] ?? '');
    expect(statSync(join(d, 'nav', 'noctis-nav')).mode & 0o777).toBe(0o755);
  });

  test('un fichier identique n’est pas réécrit ; un fichier différent est remis', () => {
    const d = dossierTemporaire();
    const { fichiers, lanceur } = fichiersNav('/bin/x', d, false);
    ecrireNav(d, fichiers, lanceur);
    const ancien = new Date('2001-01-01T00:00:00Z');
    utimesSync(join(d, 'client.mjs'), ancien, ancien);
    ecrireNav(d, fichiers, lanceur);
    expect(statSync(join(d, 'client.mjs')).mtime.getTime()).toBe(ancien.getTime());
    writeFileSync(join(d, 'cli.mjs'), 'vieille version');
    ecrireNav(d, fichiers, lanceur);
    expect(readFileSync(join(d, 'cli.mjs'), 'utf8')).toBe(SOURCES_NAV['cli.mjs'] ?? '');
  });
});

describe('préparation au démarrage du poste', () => {
  test('binaire : extrait dans <données>/nav, fixé pour les sessions, le lanceur marche', async () => {
    const donnees = dossierTemporaire();
    const dossier = preparerNav(donnees, journal, { embarquee: true, binaire: '/bin/inexistant', windows: false });
    expect(dossier).toBe(join(donnees, 'nav'));
    expect(dossierNav()).toBe(join(donnees, 'nav'));
    const env = environnementNav('/usr/bin');
    expect(env['PATH']).toBe(`${join(donnees, 'nav')}:/usr/bin`);
    expect(env['NOCTIS_NAV_CLIENT']).toBe(join(donnees, 'nav', 'client.mjs'));
    const sortie = Bun.spawnSync([join(donnees, 'nav', 'noctis-nav'), 'aide'], { stdout: 'pipe', stderr: 'pipe' });
    expect(sortie.exitCode).toBe(0);
    expect(sortie.stdout.toString()).toContain('noctis-nav <outil>');
  });

  test('développement : rien à extraire, le dossier source reste', () => {
    const donnees = dossierTemporaire();
    expect(preparerNav(donnees, journal, { embarquee: false })).toBe(DOSSIER_NAV);
    expect(existsSync(join(donnees, 'nav'))).toBe(false);
  });

  test('sous-commande nav du binaire : la CLI extraite s’exécute avec le runtime du binaire', async () => {
    const donnees = dossierTemporaire();
    preparerNav(donnees, journal, { embarquee: true, binaire: '/bin/inexistant', windows: false });
    const sortie: string[] = [];
    await executerSousCommandeNav(join(donnees, 'nav'), ['aide'], {
      sortie: (t) => void sortie.push(t),
      erreur: (t) => void sortie.push(t),
    });
    expect(sortie.join('')).toContain('noctis-nav <outil>');
    process.exitCode = undefined;
  });

  test('extraction impossible : log, pas de CLI, le PATH du poste reste seul', () => {
    const donnees = dossierTemporaire();
    const fichier = join(donnees, 'pas-un-dossier');
    writeFileSync(fichier, 'x');
    expect(preparerNav(fichier, journal, { embarquee: true, binaire: '/bin/x', windows: false })).toBeNull();
    expect(dossierNav()).toBeNull();
    expect(environnementNav('/usr/bin')).toEqual({ PATH: '/usr/bin' });
  });
});
