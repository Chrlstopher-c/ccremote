import { describe, expect, test } from 'bun:test';
import type { forkSession } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { ConfigPoste } from '../config.ts';
import type { DemandeSession, ResumeSession } from '../../commun/session.ts';
import type { TranscriptDecouvert } from './decouverte.ts';
import { type DependancesCopie, dupliquer } from './copie.ts';
import { GestionnaireSessions, moteurDe } from './gestionnaire.ts';
import type { SortieSession } from './session-poste.ts';

const demande = (surcharge: Partial<DemandeSession> = {}): DemandeSession => ({
  sessionId: '0b9c1f7e-1d2a-4c3b-8e4f-5a6b7c8d9e0f',
  projet: { machine: 'tour', chemin: '/projets/app', nom: 'app' },
  titre: 'Test',
  message: 'bonjour',
  objectif: null,
  autonomie: false,
  parc: [],
  ...surcharge,
});

describe('moteurDe', () => {
  test('une session ouverte depuis l’app tourne sur le SDK par défaut', () => {
    expect(moteurDe(demande())).toBe('sdk');
  });

  test('un moteur demandé explicitement est respecté', () => {
    expect(moteurDe(demande({ moteur: 'tmux' }))).toBe('tmux');
    expect(moteurDe(demande({ moteur: 'sdk' }))).toBe('sdk');
  });
});

const PARENTE = 'parente-1';
const COPIE = 'copie-1';

function transcript(id: string, dossier: string): TranscriptDecouvert {
  return {
    id,
    cwd: dossier,
    chemin: join(dossier, `${id}.jsonl`),
    configDir: null,
    titre: id,
    modifieLe: '2026-11-19T10:00:00.000Z',
    machine: 'tour',
    branche: null,
    messages: 1,
  };
}

describe('copie dupliquée dont le transcript n’est pas encore découvert', () => {
  function gestionnaireDeTest(dossier: string, resumes: (ResumeSession & { parentLu: string | null })[]) {
    mkdirSync(join(dossier, 'donnees'), { recursive: true });
    const config: ConfigPoste = {
      machine: 'tour',
      relais: 'ws://127.0.0.1:1/poste',
      secret: 'secret-factice',
      description: 'banc de test',
      racines: [],
      comptes: { principal: dossier },
      distants: [],
      donnees: join(dossier, 'donnees'),
      fenetreContexte: 1_000_000,
    };
    const sortie: SortieSession = {
      evenement: () => undefined,
      resume: (r) => void resumes.push({ ...r, parentLu: r.parent ?? null }),
    };
    return new GestionnaireSessions(config, sortie, join(dossier, 'poste.sock'), pino({ enabled: false }));
  }

  function depsDuGestionnaire(g: GestionnaireSessions): DependancesCopie {
    return {
      sessions: g.sessions,
      config: g.config,
      journal: pino({ enabled: false }),
      trouverImportables: () => g.trouverImportables(),
      importerUne: (t, surcharge, consignes) => g.importerUne(t, surcharge, consignes),
      attendreParent: (copie, parent) => g.attendreParent(copie, parent),
      sauvegarder: () => g.sauvegarder(),
      fork: (async () => ({ sessionId: COPIE })) as unknown as typeof forkSession,
    };
  }

  test('import tardif de la copie : sa fiche porte le parent', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'quart-gest-copie-'));
    try {
      const resumes: (ResumeSession & { parentLu: string | null })[] = [];
      const g = gestionnaireDeTest(dossier, resumes);
      g.importerUne(transcript(PARENTE, dossier));
      expect(await dupliquer(depsDuGestionnaire(g), PARENTE, 'msg-1')).toEqual({
        ok: true,
        donnees: { sessionId: COPIE },
      });
      expect(g.session(COPIE)).toBeUndefined();

      g.importerUne(transcript(COPIE, dossier));
      expect(g.session(COPIE)?.resume.parent).toBe(PARENTE);
      expect(resumes.find((r) => r.id === COPIE)?.parentLu).toBe(PARENTE);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('copie déjà ouverte au moment de la duplication : parent posé sur la fiche et republié', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'quart-gest-copie-'));
    try {
      const resumes: (ResumeSession & { parentLu: string | null })[] = [];
      const g = gestionnaireDeTest(dossier, resumes);
      g.importerUne(transcript(PARENTE, dossier));
      g.importerUne(transcript(COPIE, dossier));
      expect(g.session(COPIE)?.resume.parent).toBeFalsy();

      expect(await dupliquer(depsDuGestionnaire(g), PARENTE, 'msg-1')).toEqual({
        ok: true,
        donnees: { sessionId: COPIE },
      });
      expect(g.session(COPIE)?.resume.parent).toBe(PARENTE);
      expect(resumes.filter((r) => r.id === COPIE).at(-1)?.parentLu).toBe(PARENTE);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
