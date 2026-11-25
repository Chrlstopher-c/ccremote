// Responsabilité : l'historique gardé sur disque pour les sessions d'un pair — bornes, ordre de lecture,
// relecture après redémarrage, fichier illisible ignoré avec un journal.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { HistoriqueDistant, TAILLE_MAX_HISTORIQUE_OCTETS } from './historique-distant.ts';

const silencieux = { warn: () => undefined, debug: () => undefined } as unknown as Logger;
const CORPS = (n: number): string => JSON.stringify([{ n }]);

let dossier = '';
let chemin = '';

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'historique-distant-'));
  chemin = join(dossier, 'historique-distant.json');
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe('bornes de l’historique gardé', () => {
  test('40 sessions au plus : la plus anciennement lue sort la première', () => {
    const memoire = new HistoriqueDistant(chemin, silencieux, 10_000);
    for (let i = 0; i <= 40; i++) memoire.garder(`s${i}`, CORPS(i));
    expect(memoire.lire('s0')).toBeNull();
    expect(memoire.lire('s1')).toBe(CORPS(1));
    expect(memoire.lire('s40')).toBe(CORPS(40));
  });

  test('lire une session la rend récente : c’est une autre qui sort', () => {
    const memoire = new HistoriqueDistant(chemin, silencieux, 10_000);
    for (let i = 0; i < 40; i++) memoire.garder(`s${i}`, CORPS(i));
    expect(memoire.lire('s0')).toBe(CORPS(0));
    memoire.garder('neuve', CORPS(99));
    expect(memoire.lire('s0')).toBe(CORPS(0));
    expect(memoire.lire('s1')).toBeNull();
  });

  test('une session de plus de 2 Mo n’est pas gardée, et sa version précédente non plus', () => {
    const memoire = new HistoriqueDistant(chemin, silencieux, 10_000);
    memoire.garder('grosse', CORPS(1));
    memoire.garder('grosse', 'x'.repeat(TAILLE_MAX_HISTORIQUE_OCTETS + 1));
    expect(memoire.lire('grosse')).toBeNull();
  });

  test('une session de 2 Mo pile est gardée', () => {
    const memoire = new HistoriqueDistant(chemin, silencieux, 10_000);
    const pile = 'x'.repeat(TAILLE_MAX_HISTORIQUE_OCTETS);
    memoire.garder('pile', pile);
    expect(memoire.lire('pile')).toBe(pile);
  });
});

describe('écriture et relecture', () => {
  test('après redémarrage, l’historique reste lisible, fichier en 0600', () => {
    const avant = new HistoriqueDistant(chemin, silencieux, 10_000);
    avant.garder('s1', CORPS(1));
    avant.vider();
    expect(statSync(chemin).mode & 0o777).toBe(0o600);
    const apres = new HistoriqueDistant(chemin, silencieux, 10_000);
    expect(apres.lire('s1')).toBe(CORPS(1));
    expect(apres.lire('absente')).toBeNull();
  });

  test('écriture atomique : pas de fichier provisoire qui reste', () => {
    const memoire = new HistoriqueDistant(chemin, silencieux, 10_000);
    memoire.garder('s1', CORPS(1));
    memoire.vider();
    expect(readFileSync(chemin, 'utf8')).toContain('s1');
    expect(() => statSync(`${chemin}.neuf`)).toThrow();
  });
});

describe('fichier illisible', () => {
  test('fichier cassé : historique vide, avec un avertissement', () => {
    writeFileSync(chemin, '{pas du json');
    const alertes: unknown[] = [];
    const journal = { warn: (...a: unknown[]) => alertes.push(a), debug: () => undefined } as unknown as Logger;
    expect(new HistoriqueDistant(chemin, journal).lire('s1')).toBeNull();
    expect(alertes).toHaveLength(1);
  });

  test('entrées mal formées ignorées, les bonnes gardées', () => {
    const brut = [{ session: 1, corps: 'x' }, { session: 'ok', corps: CORPS(7) }, 'n’importe'];
    writeFileSync(chemin, JSON.stringify(brut));
    const memoire = new HistoriqueDistant(chemin, silencieux);
    expect(memoire.lire('ok')).toBe(CORPS(7));
    expect(memoire.lire('1')).toBeNull();
  });
});
