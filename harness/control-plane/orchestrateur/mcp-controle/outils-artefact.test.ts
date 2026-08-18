/**
 * L'outil bout à bout, contre un vrai registre et un vrai disque (tmpdir) :
 * c'est ici qu'on vérifie que l'artefact écrit est bien celui que le fil
 * retrouve, avec le bon type et la bonne pièce.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { creerArtefact } from './outils-artefact.ts';

let registre: Registre;
let racine: string;
const FIL = 'conv-1';

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.conversations.creer({ id: FIL, titre: 'Nouvelle conversation' });
  racine = mkdtempSync(join(tmpdir(), 'artefact-outil-test-'));
});

afterEach(() => {
  registre.fermer();
  rmSync(racine, { recursive: true, force: true });
});

describe('creer_artefact', () => {
  test('écrit la page HTML sur le disque et pose un évènement « artefact » retrouvable', async () => {
    const r = await creerArtefact(registre, racine, FIL, 'demo.html', '<html><body>ok</body></html>');
    expect(r.ok).toBe(true);
    expect(r.effet).toBe('applique');

    const evenements = registre.conversations.evenements(FIL);
    expect(evenements).toHaveLength(1);
    const ev = evenements[0];
    expect(ev?.type).toBe('artefact');
    expect(ev?.pieces).toHaveLength(1);
    expect(ev?.pieces[0]?.type).toBe('text/html');
    expect(ev?.pieces[0]?.nom).toBe('demo.html');

    const chemin = join(racine, FIL, ev?.pieces[0]?.fichier ?? '');
    expect(existsSync(chemin)).toBe(true);
    expect(await readFile(chemin, 'utf8')).toBe('<html><body>ok</body></html>');
  });

  test('un script Python pose le bon type MIME', async () => {
    const r = await creerArtefact(registre, racine, FIL, 'outil.py', 'print("bonjour")');
    expect(r.ok).toBe(true);
    const ev = registre.conversations.evenements(FIL)[0];
    expect(ev?.pieces[0]?.type).toBe('text/x-python');
  });

  test('☠ extension refusée : refus explicite, et aucun évènement posé', async () => {
    const r = await creerArtefact(registre, racine, FIL, 'binaire.exe', 'MZ');
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('.html');
    expect(registre.conversations.evenements(FIL)).toHaveLength(0);
  });

  test('☠ sans conversation rattachée, refus net et aucune exception', async () => {
    const r = await creerArtefact(registre, racine, null, 'demo.html', '<p>x</p>');
    expect(r.ok).toBe(false);
  });

  test('☠ racine non configurée : refus explicite plutôt qu’un échec inattendu', async () => {
    const r = await creerArtefact(registre, undefined, FIL, 'demo.html', '<p>x</p>');
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('CCREMOTE_PI_PIECES_JOINTES');
    expect(registre.conversations.evenements(FIL)).toHaveLength(0);
  });

  test('☠ fil inconnu : refus net', async () => {
    const r = await creerArtefact(registre, racine, 'fil-fantome', 'demo.html', '<p>x</p>');
    expect(r.ok).toBe(false);
  });

  test('deux artefacts créés dans le même fil posent deux évènements distincts', async () => {
    await creerArtefact(registre, racine, FIL, 'un.py', 'print(1)');
    await creerArtefact(registre, racine, FIL, 'deux.py', 'print(2)');
    expect(registre.conversations.evenements(FIL)).toHaveLength(2);
  });
});
