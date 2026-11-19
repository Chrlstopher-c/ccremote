import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { ContexteOutils } from './outils.ts';
import { publierArtefact } from './envoi.ts';
import {
  dupliquerArtefact,
  epinglerArtefact,
  listerArtefacts,
  renommerArtefact,
  supprimerArtefact,
} from './artefacts.ts';
import { lireRegistre } from './registre.ts';
import { Stockage } from './stockage.ts';

const SESSION = 'sess-1';
const ID = 'aaaaaaaaaaaaaaaa';

function banc(): { c: ContexteOutils; stockage: Stockage; cwd: string; racine: string } {
  const racine = mkdtempSync(join(tmpdir(), 'artefacts-'));
  const cwd = join(racine, 'projet');
  mkdirSync(cwd, { recursive: true });
  const stockage = new Stockage(join(racine, 'donnees'));
  const c: ContexteOutils = {
    sessionId: SESSION,
    cwd,
    racines: [cwd],
    stockage,
    emettre: () => undefined,
    journal: pino({ level: 'silent' }),
  };
  return { c, stockage, cwd, racine };
}

describe('artefacts : publication et registre', () => {
  test('une nouvelle version s’ajoute à l’artefact, sa source suit le dernier chemin', () => {
    const { c, stockage, cwd } = banc();
    writeFileSync(join(cwd, 'page.html'), '<h1>source</h1>');
    publierArtefact(c, { titre: 'Tableau', contenu: '<h1>v1</h1>' });
    const [premier] = listerArtefacts(stockage, SESSION);
    expect(premier?.versions.length).toBe(1);
    const id = premier?.id ?? '';
    publierArtefact(c, { titre: 'Tableau', chemin: 'page.html', id });
    const [apres] = listerArtefacts(stockage, SESSION);
    expect(apres?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(apres?.titre).toBe('Tableau');
    expect(apres?.chemin).toBe(join(cwd, 'page.html'));
  });

  test('une version publiée sans chemin est stockée et sert de chemin', () => {
    const { c, stockage } = banc();
    publierArtefact(c, { titre: 'Note', contenu: '<p>x</p>' });
    const [artefact] = listerArtefacts(stockage, SESSION);
    expect(artefact?.chemin).toBe(join(stockage.dossier(SESSION), `${artefact?.id}-v1`));
    expect(readFileSync(artefact?.chemin ?? '', 'utf8')).toBe('<p>x</p>');
  });
});

describe('artefacts : gestes', () => {
  test('renommer, épingler et lire à nouveau gardent le changement', () => {
    const { c, stockage } = banc();
    publierArtefact(c, { titre: 'Brouillon', contenu: '<p/>' });
    const id = listerArtefacts(stockage, SESSION)[0]?.id ?? '';
    renommerArtefact(stockage, SESSION, id, '  Bilan ');
    epinglerArtefact(stockage, SESSION, id, true);
    const relu = listerArtefacts(stockage, SESSION)[0];
    expect([relu?.titre, relu?.epingle]).toEqual(['Bilan', true]);
  });

  test('dupliquer copie la dernière version en version 1 sous « (copie) »', () => {
    const { c, stockage } = banc();
    publierArtefact(c, { titre: 'Tableau', contenu: '<h1>v1</h1>' });
    const id = listerArtefacts(stockage, SESSION)[0]?.id ?? '';
    publierArtefact(c, { titre: 'Tableau', contenu: '<h1>v2</h1>', id });
    const copie = dupliquerArtefact(stockage, SESSION, id);
    expect(copie.titre).toBe('Tableau (copie)');
    expect(copie.versions.map((v) => v.version)).toEqual([1]);
    expect(readFileSync(copie.chemin, 'utf8')).toBe('<h1>v2</h1>');
    expect(listerArtefacts(stockage, SESSION).length).toBe(2);
  });

  test('supprimer retire les fichiers de toutes les versions et l’entrée', () => {
    const { c, stockage } = banc();
    publierArtefact(c, { titre: 'Tableau', contenu: '<h1>v1</h1>' });
    const id = listerArtefacts(stockage, SESSION)[0]?.id ?? '';
    publierArtefact(c, { titre: 'Tableau', contenu: '<h1>v2</h1>', id });
    const dossier = stockage.dossier(SESSION);
    supprimerArtefact(stockage, SESSION, id);
    expect(listerArtefacts(stockage, SESSION)).toEqual([]);
    expect(existsSync(join(dossier, `${id}-v1`))).toBe(false);
    expect(existsSync(join(dossier, `${id}-v2.json`))).toBe(false);
  });

  test('un identifiant invalide ou inconnu lève sans rien écrire', () => {
    const { stockage } = banc();
    expect(() => renommerArtefact(stockage, SESSION, '../etc', 'x')).toThrow('identifiant d’artefact invalide');
    expect(() => epinglerArtefact(stockage, SESSION, ID, true)).toThrow('artefact inconnu');
    expect(existsSync(join(stockage.dossier(SESSION), 'artefacts.json'))).toBe(false);
  });
});

describe('artefacts : reconstitution des publications antérieures au registre', () => {
  test('un artefact sans entrée est repris depuis ses fichiers et ses métadonnées', () => {
    const { stockage } = banc();
    const dossier = stockage.dossier(SESSION);
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, `${ID}-v1`), '<h1>1</h1>');
    writeFileSync(
      join(dossier, `${ID}-v1.json`),
      JSON.stringify({ nom: 'Ancien.html', mime: 'text/html', taille: 11 }),
    );
    writeFileSync(join(dossier, `${ID}-v2`), '<h1>2</h1>');
    writeFileSync(
      join(dossier, `${ID}-v2.json`),
      JSON.stringify({ nom: 'Ancien.html', mime: 'text/html', taille: 11 }),
    );
    const [artefact] = listerArtefacts(stockage, SESSION);
    expect(artefact?.titre).toBe('Ancien');
    expect(artefact?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(artefact?.chemin).toBe(join(dossier, `${ID}-v2`));
    expect(existsSync(join(dossier, 'artefacts.json'))).toBe(false);
  });

  test('publier une version d’un artefact ancien ne le compte pas deux fois', () => {
    const { c, stockage } = banc();
    const dossier = stockage.dossier(SESSION);
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, `${ID}-v1`), '<h1>1</h1>');
    writeFileSync(
      join(dossier, `${ID}-v1.json`),
      JSON.stringify({ nom: 'Ancien.html', mime: 'text/html', taille: 11 }),
    );
    publierArtefact(c, { titre: 'Ancien', contenu: '<h1>2</h1>', id: ID });
    expect(lireRegistre(stockage, SESSION)[ID]?.versions.map((v) => v.version)).toEqual([1, 2]);
  });
});
