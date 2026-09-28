import { describe, expect, test } from 'bun:test';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';
import { sessionsAPurger } from './retention.ts';

const MAINTENANT = new Date('2026-09-28T12:00:00Z');

function session(id: string, statut: ResumeSession['statut'], majLe: string): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut,
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: majLe,
    majLe,
  };
}

describe('rétention du fil', () => {
  test('seules les sessions fermées depuis plus de 30 jours sont purgées', () => {
    const sessions = [
      session('vieille-fermee', 'fermee', '2026-08-28T11:59:59Z'),
      session('limite-fermee', 'fermee', '2026-08-29T12:00:00Z'),
      session('recente-fermee', 'fermee', '2026-09-20T00:00:00Z'),
      session('vieille-active', 'attente', '2026-01-01T00:00:00Z'),
    ];
    expect(sessionsAPurger(sessions, MAINTENANT)).toEqual(['vieille-fermee']);
  });

  test('durée paramétrable', () => {
    expect(sessionsAPurger([session('a', 'fermee', '2026-09-20T00:00:00Z')], MAINTENANT, 7)).toEqual(['a']);
  });

  test('purgerEvenements ne touche que les sessions visées', () => {
    const registre = new Registre(ouvrirBase(':memory:'));
    const evt: Evenement = { type: 'message', texte: 'x' };
    registre.ajouterEvenement('a', MAINTENANT.toISOString(), evt);
    registre.ajouterEvenement('a', MAINTENANT.toISOString(), evt);
    registre.ajouterEvenement('b', MAINTENANT.toISOString(), evt);
    expect(registre.purgerEvenements(['a'])).toBe(2);
    expect(registre.derniersEvenements('a', 10)).toHaveLength(0);
    expect(registre.derniersEvenements('b', 10)).toHaveLength(1);
  });
});
