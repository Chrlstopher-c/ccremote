// Responsabilité : tests du recalage d'une fiche sur son transcript et sa fiche Claude Desktop (écarts #7, #10, #11,
// #15, #17) : activité réelle, modèle, mode `auto`, contexte, archivage Desktop.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { etatDuTranscript, tourEnCours } from './etat-transcript.ts';
import { fichesDesktop } from './fiche-desktop.ts';
import { recalerFiche } from './recalage-fiche.ts';

const journal = pino({ enabled: false });
const IMPORT = '2026-11-20T15:04:00.000Z';
const CONV = 'c0000000-0000-4000-8000-000000000009';

const fiche = (): ResumeSession => ({
  id: CONV,
  machine: 'tour',
  projet: { machine: 'tour', chemin: '/p', nom: 'p' },
  cwd: '/p',
  titre: 't',
  objectif: null,
  modele: 'défaut',
  compte: 'principal',
  autonomie: false,
  statut: 'fermee',
  contexte: { tokens: 0, max: 200_000 },
  etapes: 0,
  compactions: 0,
  claudeSessionId: CONV,
  tmux: null,
  attachee: false,
  pilotee: false,
  creeLe: '2026-11-01T09:00:00.000Z',
  majLe: IMPORT,
});

const transcriptReel = [
  { type: 'user', timestamp: '2026-11-19T10:00:00.000Z', permissionMode: 'auto', message: { role: 'user' } },
  {
    type: 'assistant',
    timestamp: '2026-11-19T10:00:05.000Z',
    message: {
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 4,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 2_000,
        output_tokens: 9,
      },
    },
  },
  { type: 'custom-title', timestamp: '2026-11-19T10:00:06.000Z', customTitle: 'Titre' },
];

function transcript(lignes: readonly object[]): { chemin: string; nettoyer: () => void } {
  const dossier = mkdtempSync(join(tmpdir(), 'recalage-'));
  const chemin = join(dossier, `${CONV}.jsonl`);
  writeFileSync(chemin, lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { chemin, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) };
}

describe('etatDuTranscript', () => {
  test('activité, modèle, mode auto et contexte viennent du transcript', () => {
    const { chemin, nettoyer } = transcript(transcriptReel);
    try {
      expect(etatDuTranscript(chemin, journal)).toEqual({
        majLe: '2026-11-19T10:00:06.000Z',
        modele: 'claude-opus-5-5',
        mode: 'auto',
        contexte: 102_004,
        travailDernier: true,
        ecritLe: expect.any(Number) as number,
      });
    } finally {
      nettoyer();
    }
  });

  test('un fichier absent donne null', () => {
    expect(etatDuTranscript('/inexistant/x.jsonl', journal)).toBeNull();
  });
});

describe('recalerFiche', () => {
  test('une fiche importée prend l activité, le modèle, le mode et le contexte réels', () => {
    const { chemin, nettoyer } = transcript(transcriptReel);
    try {
      const r = recalerFiche(fiche(), { etat: etatDuTranscript(chemin, journal), desktop: null });
      expect(r).toMatchObject({
        majLe: '2026-11-19T10:00:06.000Z',
        modele: 'claude-opus-5-5',
        mode: 'auto',
        contexte: { tokens: 102_004, max: 200_000 },
      });
    } finally {
      nettoyer();
    }
  });

  test('sans transcript ni fiche Desktop, la fiche ne change pas', () => {
    expect(recalerFiche(fiche(), { etat: null, desktop: null })).toEqual(fiche());
  });

  test('un tour en cours rend la session travaillante ; une session fermée reste fermée', () => {
    const etat = { majLe: null, modele: null, mode: null, contexte: null, travailDernier: true, ecritLe: 0 };
    expect(recalerFiche({ ...fiche(), statut: 'attente' }, { etat, desktop: null }).statut).toBe('travail');
    expect(recalerFiche(fiche(), { etat, desktop: null }).statut).toBe('fermee');
  });

  test('une session archivée dans Desktop est archivée ici', () => {
    const r = recalerFiche(fiche(), {
      etat: null,
      desktop: {
        conversation: CONV,
        cwd: '/p',
        modele: null,
        mode: null,
        archivee: true,
        titre: null,
        remoteControl: false,
        ponts: [],
        hote: null,
      },
    });
    expect(r.archivee).toBe(true);
  });
});

describe('fichesDesktop', () => {
  test('lit les fiches local_*.json (archivage, mode) en lecture seule', () => {
    const racine = mkdtempSync(join(tmpdir(), 'desktop-'));
    try {
      const dossier = join(racine, 'org', 'compte');
      mkdirSync(dossier, { recursive: true });
      writeFileSync(
        join(dossier, 'local_1.json'),
        JSON.stringify({
          cliSessionId: CONV,
          cwd: '/p',
          model: 'claude-sonnet-5-5',
          permissionMode: 'auto',
          isArchived: true,
        }),
      );
      writeFileSync(join(dossier, 'autre.json'), '{}');
      const carte = fichesDesktop(racine, journal);
      expect(carte.get(CONV)).toMatchObject({ archivee: true, mode: 'auto', modele: 'claude-sonnet-5-5' });
      expect(carte.size).toBe(1);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});

describe('tourEnCours (#6)', () => {
  const base = { majLe: null, modele: null, mode: null, contexte: null };
  test('un signal « en cours » l emporte ; une fin de tour rend la session inactive, même écrite à l instant', () => {
    expect(tourEnCours({ ...base, travailDernier: true, ecritLe: 0 }, 10)).toBe(true);
    expect(tourEnCours({ ...base, travailDernier: false, ecritLe: 9 }, 10)).toBe(false);
  });
  test('sans signal : en cours seulement si le transcript a bougé il y a peu', () => {
    expect(tourEnCours({ ...base, travailDernier: null, ecritLe: 1_000 }, 60_000)).toBe(true);
    expect(tourEnCours({ ...base, travailDernier: null, ecritLe: 1_000 }, 600_000)).toBe(false);
  });
});
