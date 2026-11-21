import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { cheminEdite } from './crochet-edition.ts';
import { TAILLE_MAX_OCTETS, ToursSession } from './tours.ts';

const journal = pino({ enabled: false });
let base = '';
let racine = '';
let donnees = '';

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'quart-tours-'));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  racine = mkdtempSync(join(base, 'session-'));
  donnees = mkdtempSync(join(base, 'donnees-'));
});

function nouvelle(): ToursSession {
  return new ToursSession({ sessionId: 'session-1', racine, donnees, journal });
}

function ecrire(nom: string, texte: string): string {
  const chemin = join(racine, nom);
  mkdirSync(join(chemin, '..'), { recursive: true });
  writeFileSync(chemin, texte);
  return chemin;
}

describe('capture d’un tour', () => {
  test('garde l’avant à la première édition, écarte l’inchangé, compte les lignes', () => {
    const t = nouvelle();
    const a = ecrire('a.txt', 'un\ndeux\n');
    const b = ecrire('b.txt', 'stable\n');
    t.noterAvant(a);
    t.noterAvant(b);
    writeFileSync(a, 'un\ndeux\ntrois\n');
    t.noterAvant(a); // déjà noté : l'avant reste celui d'avant la première édition
    const fin = t.finirTour();
    expect(fin?.fichiers).toEqual([{ chemin: 'a.txt', etat: 'modifie', ajouts: 1, suppressions: 0, binaire: false }]);
    expect(t.diff(fin?.tour ?? '', 'a.txt').hunks[0]?.lignes.map((l) => [l.genre, l.texte])).toEqual([
      ['contexte', 'un'],
      ['contexte', 'deux'],
      ['ajout', 'trois'],
    ]);
  });

  test('aucun changement réel : pas de tour', () => {
    const t = nouvelle();
    const a = ecrire('a.txt', 'x\n');
    t.noterAvant(a);
    expect(t.finirTour()).toBeNull();
    expect(t.finirTour()).toBeNull();
  });

  test('un fichier trop gros n’est pas relevé', () => {
    const t = nouvelle();
    const gros = join(racine, 'gros.bin');
    writeFileSync(gros, Buffer.alloc(TAILLE_MAX_OCTETS + 1));
    t.noterAvant(gros);
    writeFileSync(gros, 'petit\n');
    expect(t.finirTour()).toBeNull();
  });

  test('chemins exposés : relatifs au dossier, absolus hors du dossier', () => {
    const t = nouvelle();
    const dedans = ecrire('src/mod.ts', 'a\n');
    const dehors = join(donnees, 'hors.txt');
    writeFileSync(dehors, 'h\n');
    t.noterAvant(dedans);
    t.noterAvant(dehors);
    writeFileSync(dedans, 'b\n');
    writeFileSync(dehors, 'i\n');
    const chemins = t.finirTour()?.fichiers.map((f) => f.chemin);
    expect(chemins).toEqual(['src/mod.ts', dehors]);
  });
});

describe('annulation d’un tour', () => {
  test('remet l’avant, supprime ce qui a été créé, et ne peut pas servir deux fois', async () => {
    const t = nouvelle();
    const a = ecrire('a.txt', 'un\n');
    const nouveau = join(racine, 'nouveau.txt');
    t.noterAvant(a);
    t.noterAvant(nouveau);
    writeFileSync(a, 'changé\n');
    writeFileSync(nouveau, 'neuf\n');
    const fin = t.finirTour();
    expect(fin?.fichiers.map((f) => f.etat)).toEqual(['modifie', 'ajoute']);
    expect(t.annuler(fin?.tour ?? '')).toEqual({ tour: fin?.tour ?? '', fichiers: 2 });
    expect(readFileSync(a, 'utf8')).toBe('un\n');
    expect(existsSync(nouveau)).toBe(false);
    expect(() => t.annuler(fin?.tour ?? '')).toThrow('tour déjà annulé');
    expect((await t.modifications(fin?.tour ?? '')).fichiers).toEqual([]);
  });

  test('un fichier supprimé pendant le tour revient', () => {
    const t = nouvelle();
    const a = ecrire('a.txt', 'garde-moi\n');
    t.noterAvant(a);
    rmSync(a);
    const fin = t.finirTour();
    expect(fin?.fichiers[0]).toMatchObject({ chemin: 'a.txt', etat: 'supprime' });
    t.annuler(fin?.tour ?? '');
    expect(readFileSync(a, 'utf8')).toBe('garde-moi\n');
  });

  test('refuse, sans rien toucher, si un fichier a changé depuis la fin du tour', () => {
    const t = nouvelle();
    const a = ecrire('a.txt', 'avant a\n');
    const d = ecrire('d.txt', 'avant d\n');
    t.noterAvant(a);
    t.noterAvant(d);
    writeFileSync(a, 'après a\n');
    writeFileSync(d, 'après d\n');
    const fin = t.finirTour();
    writeFileSync(a, 'modifié ailleurs\n');
    expect(() => t.annuler(fin?.tour ?? '')).toThrow('modifié depuis la fin du tour : a.txt');
    expect(readFileSync(a, 'utf8')).toBe('modifié ailleurs\n');
    expect(readFileSync(d, 'utf8')).toBe('après d\n');
  });

  test('`dernier` désigne le tour enregistré le plus récent', async () => {
    const t = nouvelle();
    const a = ecrire('a.txt', 'a\n');
    t.noterAvant(a);
    writeFileSync(a, 'a2\n');
    const premier = t.finirTour()?.tour ?? '';
    await Bun.sleep(5);
    const b = ecrire('b.txt', 'b\n');
    t.noterAvant(b);
    writeFileSync(b, 'b2\n');
    const second = t.finirTour()?.tour ?? '';
    expect((await t.modifications('dernier')).fichiers.map((f) => f.chemin)).toEqual(['b.txt']);
    expect((await t.modifications(premier)).fichiers.map((f) => f.chemin)).toEqual(['a.txt']);
    expect(second).not.toBe(premier);
  });

  test('une référence de tour inconnue ou absente donne « tour inconnu »', async () => {
    const t = nouvelle();
    expect(() => t.annuler('dernier')).toThrow('tour inconnu');
    await expect(t.modifications('0000-inconnu')).rejects.toThrow('tour inconnu');
    expect(() => t.diff('../../etc', 'x')).toThrow('tour inconnu');
  });
});

describe('chemin d’un fichier de tour', () => {
  test('une entrée sans chemin ne désigne aucun fichier', () => {
    expect(cheminEdite({ file_path: 'src/a.ts' }, racine)).toBe(join(racine, 'src/a.ts'));
    expect(cheminEdite({ notebook_path: '/abs/n.ipynb' }, racine)).toBe('/abs/n.ipynb');
    expect(cheminEdite({ commande: 'ls' }, racine)).toBeNull();
    expect(cheminEdite('pas un objet', racine)).toBeNull();
  });
});

describe('chemins de toute la session', () => {
  test('les fichiers des tours non annulés, sans doublon ; un tour annulé ne compte plus', () => {
    const t = nouvelle();
    const a = ecrire('a.txt', 'un\n');
    t.noterAvant(a);
    writeFileSync(a, 'deux\n');
    t.finirTour();
    const b = ecrire('b.txt', 'x\n');
    t.noterAvant(b);
    writeFileSync(b, 'y\n');
    const tour = t.finirTour();
    expect(t.chemins().sort()).toEqual([a, b].sort());
    t.annuler(tour?.tour ?? 'dernier');
    expect(t.chemins()).toEqual([a]);
  });
});
