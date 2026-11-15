import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession, StatutSession } from '../../commun/session.ts';
import type { SessionPersistee } from './persistance.ts';
import {
  RAISON_REDEMARRAGE,
  relancerApresRedemarrage,
  reprisePrevue,
  type SessionReprenable,
  TEXTE_REDEMARRAGE,
} from './reprise.ts';

const journal = pino({ level: 'silent' });

function persistee(statut: StatutSession, aReprendre: boolean, moteur: 'sdk' | 'tmux' = 'sdk'): SessionPersistee {
  const resume: ResumeSession = {
    id: 'quart-1',
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/projets/app', nom: 'app' },
    cwd: '/projets/app',
    titre: 'Test',
    objectif: null,
    modele: 'défaut',
    compte: 'principal',
    autonomie: false,
    statut,
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'claude-abc',
    moteur,
    tmux: null,
    attachee: false,
    pilotee: true,
    creeLe: '2026-11-15T00:00:00.000Z',
    majLe: '2026-11-15T00:00:00.000Z',
  };
  return { resume, consignes: null, configDir: null, transcript: null, position: 0, aReprendre };
}

type Appel = { id: string; texte: string | null; a: number };

function fausseSession(id: string, appels: Appel[], erreur: string | null = null) {
  const session: SessionReprenable = {
    resume: { id },
    reprendreApresRedemarrage(texte) {
      appels.push({ id, texte, a: Date.now() });
      return erreur;
    },
  };
  return session;
}

describe('reprisePrevue', () => {
  test('une session qui attendait Chris reprend en silence', () => {
    expect(reprisePrevue(persistee('attente', true))).toEqual({ texte: null });
    expect(reprisePrevue(persistee('terminee', true))).toEqual({ texte: null });
    expect(reprisePrevue(persistee('erreur', true))).toEqual({ texte: null });
  });

  test('un tour en cours reprend avec le message du poste', () => {
    for (const statut of ['travail', 'compaction', 'question'] as const) {
      expect(reprisePrevue(persistee(statut, true))).toEqual({ texte: TEXTE_REDEMARRAGE });
    }
  });

  test('une session fermée par Chris ou finie ne se rouvre pas', () => {
    expect(reprisePrevue(persistee('fermee', false))).toBeNull();
    expect(reprisePrevue(persistee('attente', false))).toBeNull();
  });

  test('une session tmux n’est pas reprise par ce module', () => {
    expect(reprisePrevue(persistee('travail', true, 'tmux'))).toBeNull();
  });
});

describe('relancerApresRedemarrage', () => {
  test('les reprises partent une à une, espacées, dans l’ordre', async () => {
    const appels: Appel[] = [];
    const reprises = [
      { session: fausseSession('a', appels), texte: null },
      { session: fausseSession('b', appels), texte: TEXTE_REDEMARRAGE },
    ];
    await relancerApresRedemarrage(reprises, journal, 30);
    expect(appels.map((a) => a.id)).toEqual(['a', 'b']);
    expect(appels[1]?.texte).toBe(TEXTE_REDEMARRAGE);
    expect((appels[1]?.a ?? 0) - (appels[0]?.a ?? 0)).toBeGreaterThanOrEqual(25);
  });

  test('une reprise en échec ou qui lève une exception ne bloque pas les suivantes', async () => {
    const appels: Appel[] = [];
    const leve: SessionReprenable = {
      resume: { id: 'c' },
      reprendreApresRedemarrage() {
        throw new Error('processus introuvable');
      },
    };
    const reprises = [
      { session: fausseSession('a', appels, 'conversation inconnue'), texte: null },
      { session: leve, texte: null },
      { session: fausseSession('d', appels), texte: null },
    ];
    await relancerApresRedemarrage(reprises, journal, 1);
    expect(appels.map((a) => a.id)).toEqual(['a', 'd']);
  });

  test('la raison de relance est fixée par le module', () => {
    expect(RAISON_REDEMARRAGE).toBe('redémarrage du poste');
  });
});
