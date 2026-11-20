// Responsabilité : tests de l'affichage réel d'une session claude.ai jumelle d'une session de poste (écarts #2 et #3).
import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { avecJumelleReelle } from './jumelle-distante.ts';

const base = (over: Partial<ResumeSession>): ResumeSession =>
  ({
    id: 'cse_011H3TDb2v',
    machine: 'portable',
    cwd: 'Remote Control',
    projet: { machine: 'portable', chemin: 'Remote Control', nom: 'Remote Control' },
    distant: { compte: 'principal', idDistant: 'cse_011H3TDb2v', connexion: 'connectee', probleme: null },
    ...over,
  }) as ResumeSession;

describe('avecJumelleReelle', () => {
  test('la session claude.ai affiche la machine, le dossier et la conversation de sa jumelle', () => {
    const jumelle = base({ id: 'x', machine: 'tour', cwd: '/home/trinity/projet', claudeSessionId: 'uuid-jumelle' });
    const r = avecJumelleReelle(base({}), jumelle);
    expect(r.distant).toMatchObject({
      conversation: 'uuid-jumelle',
      machineReelle: 'tour',
      cwdReel: '/home/trinity/projet',
    });
    expect(r.machine).toBe('portable');
  });

  test('sans jumelle, rien ne change', () => {
    const s = base({});
    expect(avecJumelleReelle(s, null)).toBe(s);
  });
});
