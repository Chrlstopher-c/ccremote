import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { changementsInactivite } from './recalcul-inactivite.ts';

const MAJ = '2026-11-15T10:00:00.000Z';

function session(id: string, inactiveDepuis: string | null): ResumeSession {
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
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: 'x',
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    inactiveDepuis,
    archivee: false,
  };
}

describe('recalcul de l inactivité', () => {
  test('premier passage : seules les sessions déjà inactives sont à diffuser', () => {
    const r = changementsInactivite([session('a', MAJ), session('b', null)], new Map());
    expect(r.changees.map((s) => s.id)).toEqual(['a']);
    expect(r.etat.get('a')).toBe(MAJ);
    expect(r.etat.get('b')).toBeNull();
  });

  test('aucun changement : rien à diffuser', () => {
    const r = changementsInactivite([session('a', MAJ)], new Map([['a', MAJ]]));
    expect(r.changees).toEqual([]);
  });

  test('passage à inactive puis retour à null : diffusés une fois chacun', () => {
    const suivi = new Map<string, string | null>([['a', null]]);
    const passage = changementsInactivite([session('a', MAJ)], suivi);
    expect(passage.changees.map((s) => s.id)).toEqual(['a']);
    const retour = changementsInactivite([session('a', null)], passage.etat);
    expect(retour.changees.map((s) => s.id)).toEqual(['a']);
    expect(retour.etat.get('a')).toBeNull();
  });
});
