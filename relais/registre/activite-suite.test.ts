// Responsabilité : la date d'activité d'une session suit les événements relus dans son transcript, pas l'heure de la
// relecture (écart #8 : une conversation relue en retard restait figée à sa date d'import).
import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const IMPORT = '2026-11-20T15:14:00.000Z';

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
    creeLe: '2026-10-31T09:00:00.000Z',
    majLe: IMPORT,
  };
}

describe('ajouterSuite : date d activité', () => {
  test('la fiche prend l horodatage du dernier événement relu, pas l heure de la relecture', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    r.ajouterSuite('a', [
      { ts: '2026-11-19T15:04:00.000Z', evt: { type: 'message', texte: 'x', uuid: 'm1' } },
      { ts: '2026-11-19T16:30:00.000Z', evt: { type: 'texte', texte: 'y', uuid: 'r1' } },
    ]);
    expect(r.session('a')?.majLe).toBe('2026-11-19T16:30:00.000Z');
    expect(r.sessions().find((s) => s.id === 'a')?.majLe).toBe('2026-11-19T16:30:00.000Z');
  });

  test('une fiche importée à tort à l heure de l import reprend la date du transcript', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    r.ajouterSuite('a', [{ ts: '2026-11-01T10:00:00.000Z', evt: { type: 'message', texte: 'x', uuid: 'm1' } }]);
    expect(r.session('a')?.majLe).toBe('2026-11-01T10:00:00.000Z');
  });

  test('une session archivée dans Desktop arrive archivée au relais, et Chris peut la rouvrir ensuite', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession({ ...session('b'), archivee: true });
    expect(r.sessions().find((s) => s.id === 'b')).toBeUndefined();
    expect(r.session('b')?.archivee).toBe(true);
    r.definirArchivee('b', false);
    r.enregistrerSession({ ...session('b'), archivee: true });
    expect(r.session('b')?.archivee).toBe(false);
  });
});
