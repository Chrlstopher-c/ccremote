// Journal et origine de la pause du nœud : chaque changement réel est écrit en info avec son origine, un redémarrage
// sur un drapeau posé prévient en warn, pause.json garde l'heure et l'origine, et les anciens fichiers restent lus.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ActionsNoeud, type DependancesActions } from './actions-noeud.ts';
import { PauseNoeud } from './pause-noeud.ts';

type Ligne = { level: number; msg: string; pause?: boolean; origine?: string };

let dossier: string;
let lignes: Ligne[];

function journal() {
  return pino({ level: 'info' }, { write: (brut: string) => void lignes.push(JSON.parse(brut) as Ligne) });
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'pause-noeud-'));
  lignes = [];
});

afterEach(() => {
  lignes = [];
});

const messages = (niveau: number): string[] => lignes.filter((l) => l.level === niveau).map((l) => l.msg);

describe('journal de la pause', () => {
  test('une pause effective est journalisée en info avec son origine', () => {
    const pause = new PauseNoeud(dossier, journal());
    expect(pause.mettreEnPause(true, 'appareil:tel1')).toBe(true);
    const info = lignes.find((l) => l.msg === 'nœud mis en pause');
    expect(info).toMatchObject({ level: 30, pause: true, origine: 'appareil:tel1' });
  });

  test('une reprise effective est journalisée en info', () => {
    const pause = new PauseNoeud(dossier, journal());
    pause.mettreEnPause(true, 'local');
    pause.mettreEnPause(false, 'membre:abc');
    expect(lignes.find((l) => l.msg === 'nœud repris')).toMatchObject({ pause: false, origine: 'membre:abc' });
  });

  test('sans changement réel, rien n’est journalisé', () => {
    const pause = new PauseNoeud(dossier, journal());
    pause.mettreEnPause(false, 'local');
    pause.mettreEnPause(true, 'local');
    pause.mettreEnPause(true, 'local');
    expect(messages(30)).toEqual(['nœud mis en pause']);
  });

  test('sans origine connue, la trace porte « inconnue »', () => {
    const pause = new PauseNoeud(dossier, journal());
    pause.mettreEnPause(true);
    expect(lignes.find((l) => l.msg === 'nœud mis en pause')?.origine).toBe('inconnue');
  });

  test('un échec d’écriture ne journalise pas de changement', () => {
    const pause = new PauseNoeud(join(dossier, 'pas-un-dossier', 'x'), journal());
    writeFileSync(join(dossier, 'pas-un-dossier'), 'fichier');
    expect(pause.mettreEnPause(true, 'local')).toBe(false);
    expect(messages(30)).toEqual([]);
  });

  test('l’origine remonte jusqu’à l’action locale', async () => {
    const deps = { pause: new PauseNoeud(dossier, journal()) } as DependancesActions;
    const actions = new ActionsNoeud({ ...deps, journal: journal() });
    const r = await actions.executerLocale('pause', 'local');
    expect(r.ok).toBe(true);
    expect(lignes.find((l) => l.msg === 'nœud mis en pause')?.origine).toBe('local');
  });
});

describe('démarrage et fichier pause.json', () => {
  test('un drapeau posé au démarrage prévient en warn', () => {
    new PauseNoeud(dossier, journal()).mettreEnPause(true, 'local');
    lignes = [];
    expect(new PauseNoeud(dossier, journal()).enPause()).toBe(true);
    expect(messages(40)).toEqual(['nœud en pause au démarrage : aucune nouvelle session']);
  });

  test('sans drapeau ou drapeau à faux, aucun avertissement au démarrage', () => {
    new PauseNoeud(dossier, journal());
    writeFileSync(join(dossier, 'pause.json'), '{"pause":false}\n');
    new PauseNoeud(dossier, journal());
    expect(messages(40)).toEqual([]);
  });

  test('pause.json garde l’heure (ISO) et l’origine du dernier changement', () => {
    new PauseNoeud(dossier, journal()).mettreEnPause(true, 'membre:m1');
    const contenu = JSON.parse(readFileSync(join(dossier, 'pause.json'), 'utf8')) as Record<string, unknown>;
    expect(contenu['pause']).toBe(true);
    expect(contenu['origine']).toBe('membre:m1');
    expect(Number.isNaN(Date.parse(String(contenu['le'])))).toBe(false);
  });

  test('un ancien fichier {pause} reste lu', () => {
    writeFileSync(join(dossier, 'pause.json'), '{"pause":true}\n');
    expect(new PauseNoeud(dossier, journal()).enPause()).toBe(true);
  });
});
