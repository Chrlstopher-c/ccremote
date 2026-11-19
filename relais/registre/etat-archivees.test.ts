// Responsabilité : garde-fou de la lecture de l'état rangé (`/api/etat?archivees=1`) — la liste des sessions se lit
// dans la base, sans relire de transcript, et reste sous 300 ms pour plusieurs centaines de sessions.
import { expect, test } from 'bun:test';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';
import { ResumeSession } from '../../commun/session.ts';

const MAJ = '2026-11-19T10:00:00.000Z';

function session(i: number) {
  return ResumeSession.parse({
    id: `s-${i}`,
    machine: i % 2 === 0 ? 'tour' : 'portable',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: `session ${i}`,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  });
}

test('400 sessions, rangées comprises : la liste se lit en moins de 300 ms, sans relire de transcript', () => {
  const r = new Registre(ouvrirBase(':memory:'));
  for (let i = 0; i < 400; i++) r.enregistrerSession(session(i));
  for (let i = 0; i < 100; i++) r.definirArchivee(`s-${i}`, true);
  const debut = performance.now();
  const liste = r.sessions(true);
  const duree = performance.now() - debut;
  expect(liste).toHaveLength(400);
  expect(duree).toBeLessThan(300);
});
