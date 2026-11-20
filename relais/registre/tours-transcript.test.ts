// Responsabilité : tests des jetons et du nombre de tours d'une session suivie hors de Lanterne — le relais compte
// les `tour_fini` du fil ; un tour renvoyé par un chevauchement ou une relecture complète ne compte pas deux fois.
import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import type { EvenementHorodate } from '../parc/fusion-historique.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const MAJ = '2026-11-18T10:00:00.000Z';
const T1 = '2026-11-01T10:00:04.000Z';
const T2 = '2026-11-01T10:00:09.000Z';

function session(id: string): ResumeSession {
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
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function tour(ts: string, entree: number, sortie: number, uuid: string): EvenementHorodate {
  return { ts, evt: { type: 'tour_fini', dureeMs: 1000, contexte: 10, entree, sortie, uuid } };
}

function message(ts: string, uuid: string): EvenementHorodate {
  return { ts, evt: { type: 'message', texte: 'bonjour', uuid } };
}

const PREMIER: EvenementHorodate[] = [message(T1, 'u1'), tour(T1, 277, 50, 'a3')];
const SUITE: EvenementHorodate[] = [tour(T1, 277, 50, 'a3'), message(T2, 'u3'), tour(T2, 230, 40, 'a4')];

describe('jetons d’une session suivie hors de Lanterne', () => {
  test('la suite qui reprend le dernier tour ne le compte pas deux fois', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    r.ajouterHistorique('a', PREMIER);
    r.fusionnerHistorique('a', SUITE, { complet: false, premier: false });
    expect(r.jetonsSession('a')).toEqual({ entree: 507, sortie: 90, tours: 2 });
  });

  test('une relecture complète qui renvoie tout donne les mêmes totaux', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    r.fusionnerHistorique('a', SUITE, { complet: true, premier: true });
    r.fusionnerHistorique('a', SUITE, { complet: true, premier: false });
    expect(r.jetonsSession('a')).toEqual({ entree: 507, sortie: 90, tours: 2 });
  });

  test('un tour déjà compté par le SDK puis relu du transcript (même réponse) ne compte qu’une fois', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    r.ajouterEvenement('a', T1, { type: 'tour_fini', dureeMs: 900, contexte: 10, entree: 280, sortie: 52, uuid: 'a3' });
    r.fusionnerHistorique('a', SUITE, { complet: true, premier: false });
    expect(r.jetonsSession('a')).toEqual({ entree: 507 + 3, sortie: 90 + 2, tours: 2 });
  });
});
