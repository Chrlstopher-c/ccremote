// Responsabilité : tests des fichiers modifiés par tour et des totaux +/− d'une session relue dans son transcript —
// mêmes fichiers et mêmes chiffres à la relecture complète et au suivi incrémental (quelle que soit la coupure), sans
// double compte au chevauchement ; coût seulement quand le transcript le donne.
import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { evenementsDuTranscript, type EvenementHorodate, lignesDe } from './historique.ts';
import { LectureIncrementale } from './lecture-incrementale.ts';
import { cheminsModifies } from './tours-transcript.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'tours-edition.jsonl');
const LIGNES = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');

const ATTENDUS: Evenement[] = [
  {
    type: 'fichiers_tour',
    tour: 'a3b',
    fichiers: [
      { chemin: '/repo/src/a.ts', etat: 'modifie', ajouts: 1, suppressions: 1, binaire: false },
      { chemin: '/repo/src/nouveau.ts', etat: 'ajoute', ajouts: 2, suppressions: 0, binaire: false },
    ],
  },
  {
    type: 'tour_fini',
    dureeMs: 5000,
    contexte: 130,
    entree: 160,
    sortie: 25,
    uuid: 'a3b',
    coutUsd: 0.42,
  },
  {
    type: 'fichiers_tour',
    tour: 'a5',
    fichiers: [{ chemin: '/repo/src/a.ts', etat: 'modifie', ajouts: 2, suppressions: 1, binaire: false }],
  },
  { type: 'tour_fini', dureeMs: 3000, contexte: 50, entree: 90, sortie: 15, uuid: 'a5' },
];

function fils(evenements: readonly EvenementHorodate[]): Evenement[] {
  return evenements.map((e) => e.evt).filter((evt) => evt.type === 'tour_fini' || evt.type === 'fichiers_tour');
}

function relecture(lignes: readonly string[]): Evenement[] {
  return fils(evenementsDuTranscript(lignes.join('\n')));
}

describe('fichiers modifiés et totaux d’une session relue dans son transcript', () => {
  test('relecture complète : fichiers et chiffres par tour, puis fin de tour', () => {
    expect(relecture(LIGNES)).toEqual(ATTENDUS);
  });

  test('suivi incrémental, coupé à chaque ligne : mêmes événements, sans double compte', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'quart-edition-'));
    const chemin = join(dossier, 'session.jsonl');
    try {
      for (let coupure = 1; coupure < LIGNES.length; coupure += 1) {
        writeFileSync(chemin, `${LIGNES.slice(0, coupure).join('\n')}\n`);
        const lecture = new LectureIncrementale(chemin, pino({ enabled: false }));
        const vus: EvenementHorodate[] = [...lecture.relireTout()];
        appendFileSync(chemin, `${LIGNES.slice(coupure).join('\n')}\n`);
        vus.push(...(lecture.ajout() ?? []));
        expect(fils(vus)).toEqual(ATTENDUS);
      }
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('coût absent quand le transcript n’en porte pas après la réponse', () => {
    const sansCout = LIGNES.filter((l) => !l.includes('"cost-state"'));
    const premier = relecture(sansCout)[1];
    expect(premier).toEqual({ type: 'tour_fini', dureeMs: 5000, contexte: 130, entree: 160, sortie: 25, uuid: 'a3b' });
    expect(premier && 'coutUsd' in premier).toBe(false);
  });

  test('chemins modifiés par les tours clos, le tour non clos exclu', () => {
    const chemins = cheminsModifies(lignesDe(LIGNES.join('\n')));
    expect(chemins).toEqual(['/repo/src/a.ts', '/repo/src/nouveau.ts']);
  });
});
