import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const MAJ = '2026-11-18T10:00:00.000Z';

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

describe('historique d’une session découverte', () => {
  test('un lot s’écrit dans l’ordre du transcript et les chapitres le retrouvent', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const lot = [
      { ts: MAJ, evt: { type: 'message' as const, texte: 'bonjour', uuid: 'm1' } },
      { ts: MAJ, evt: { type: 'texte' as const, texte: 'salut', uuid: 'r1' } },
      { ts: MAJ, evt: { type: 'message' as const, texte: 'suite', uuid: 'm2' } },
    ];
    expect(r.ajouterHistorique('a', lot)).toBe(3);
    const relus = r.derniersEvenements('a', 300);
    expect(relus.map((e) => e.evt.type)).toEqual(['message', 'texte', 'message']);
    expect(r.rangEntree('a', 'm2')).toBe(3);
  });
});
