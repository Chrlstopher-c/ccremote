import { describe, expect, test } from 'bun:test';
import type { DemandeSession } from '../../commun/session.ts';
import { moteurDe } from './gestionnaire.ts';

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
