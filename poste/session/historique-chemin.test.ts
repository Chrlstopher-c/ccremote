import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { lecteurImagesChemin } from '../presentation/images-chemin.ts';
import { Stockage } from '../presentation/stockage.ts';
import { evenementsDuTranscript, stockeurImages } from './historique.ts';

const journal = pino({ enabled: false });
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_B64 = PNG_1x1.toString('base64');
const SESSION = 'sess';
const HORODATAGE = '2026-11-01T10:00:00.000Z';

let racine: string;
let dossierImages: string;

beforeAll(() => {
  racine = mkdtempSync(join(tmpdir(), 'historique-chemin-'));
  dossierImages = join(racine, 'captures');
  mkdirSync(dossierImages);
  writeFileSync(join(dossierImages, 'g2.png'), PNG_1x1);
});

afterAll(() => {
  rmSync(racine, { recursive: true, force: true });
});

// Une ligne de transcript dont le résultat d'outil ne porte que le chemin de la capture (comme browser_screenshot).
function ligneResultat(chemin: string, extra: Record<string, unknown> = {}): string {
  const resultat = JSON.stringify({ success: true, path: chemin, full_page: false });
  return JSON.stringify({
    type: 'user',
    uuid: 'r-1',
    parentUuid: null,
    timestamp: HORODATAGE,
    sessionId: SESSION,
    ...extra,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: resultat }] },
  });
}

function imagesDe(evts: readonly { evt: Evenement }[]): Extract<Evenement, { type: 'image' }>[] {
  return evts.map((e) => e.evt).filter((e): e is Extract<Evenement, { type: 'image' }> => e.type === 'image');
}

function fichiersStockes(): string[] {
  return readdirSync(new Stockage(racine).dossier(SESSION)).filter((nom) => !nom.endsWith('.json'));
}

describe('historique : images citées par chemin dans un résultat d’outil', () => {
  test('une ligne tool_result avec le chemin d’une capture émet une image d’origine outil', () => {
    const stocker = stockeurImages(new Stockage(racine), SESSION, journal);
    const lire = lecteurImagesChemin(null, journal);
    const evts = evenementsDuTranscript(ligneResultat(join(dossierImages, 'g2.png')), stocker, lire);
    const images = imagesDe(evts);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ type: 'image', origine: 'outil', mime: 'image/png', nom: 'g2.png' });
    expect(evts[0]?.ts).toBe(HORODATAGE);
  });

  test('relue deux fois : même fichier, stocké une seule fois', () => {
    const stocker = stockeurImages(new Stockage(racine), SESSION, journal);
    const lire = lecteurImagesChemin(null, journal);
    const ligne = ligneResultat(join(dossierImages, 'g2.png'));
    const premiere = imagesDe(evenementsDuTranscript(ligne, stocker, lire));
    const seconde = imagesDe(evenementsDuTranscript(ligne, stocker, lire));
    expect(premiere[0]?.fichier).toBeDefined();
    expect(seconde.map((i) => i.fichier)).toEqual(premiere.map((i) => i.fichier));
    expect(fichiersStockes()).toEqual([premiere[0]?.fichier ?? '']);
  });

  test('sans lecteur injecté : aucune image par chemin (comportement inchangé)', () => {
    const stocker = stockeurImages(new Stockage(racine), SESSION, journal);
    expect(imagesDe(evenementsDuTranscript(ligneResultat(join(dossierImages, 'g2.png')), stocker))).toHaveLength(0);
  });

  test('chemin hors des racines permises : rien n’est émis', () => {
    const stocker = stockeurImages(new Stockage(racine), SESSION, journal);
    const lire = lecteurImagesChemin([join(racine, 'autre')], journal);
    const ligne = ligneResultat(join(dossierImages, 'g2.png'));
    expect(imagesDe(evenementsDuTranscript(ligne, stocker, lire))).toHaveLength(0);
  });

  test('ligne d’un sous-agent (sidechain) : jamais présentée dans le fil', () => {
    const stocker = stockeurImages(new Stockage(racine), SESSION, journal);
    const lire = lecteurImagesChemin(null, journal);
    const ligne = ligneResultat(join(dossierImages, 'g2.png'), { isSidechain: true });
    expect(imagesDe(evenementsDuTranscript(ligne, stocker, lire))).toHaveLength(0);
  });

  test('image base64 et chemin dans la même ligne : rangs à la suite', () => {
    const stocker = stockeurImages(new Stockage(racine), SESSION, journal);
    const lire = lecteurImagesChemin(null, journal);
    const ligne = JSON.stringify({
      type: 'user',
      uuid: 'r-2',
      timestamp: HORODATAGE,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } }],
          },
          { type: 'tool_result', tool_use_id: 'b', content: JSON.stringify({ path: join(dossierImages, 'g2.png') }) },
        ],
      },
    });
    const images = imagesDe(evenementsDuTranscript(ligne, stocker, lire));
    expect(images.map((i) => i.nom)).toEqual(['image-1.png', 'g2.png']);
    expect(images.every((i) => i.origine === 'outil')).toBe(true);
  });
});
