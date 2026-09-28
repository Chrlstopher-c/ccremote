import { describe, expect, test } from 'bun:test';
import type { DemandeSession } from '../../commun/session.ts';
import { composerConsignes } from './consignes.ts';

const demande = (d: Partial<DemandeSession> = {}): DemandeSession => ({
  sessionId: 's1',
  projet: { machine: 'tour', chemin: '/mnt/projects/x', nom: 'x' },
  titre: 'Refonte',
  message: 'go',
  objectif: 'Livrer X',
  autonomie: true,
  parc: [
    { id: 'tour', description: 'PC fixe', racines: ['/mnt/projects'] },
    { id: 'pi', description: 'Raspberry Pi', racines: [] },
  ],
  ...d,
});

describe('consignes de session', () => {
  test('projet local : le cwd est le projet', () => {
    const t = composerConsignes({ machine: 'tour', cwd: '/mnt/projects/x', demande: demande() });
    expect(t).toContain('dans `/mnt/projects/x` (ton répertoire courant)');
    expect(t).toContain('Livrer X');
  });

  test('projet distant : la session passe par ssh', () => {
    const t = composerConsignes({ machine: 'pi', cwd: '/home/pi/w', demande: demande() });
    expect(t).toContain('via `ssh tour`');
  });

  test('le parc exclut la machine courante et rappelle où builder', () => {
    const t = composerConsignes({ machine: 'tour', cwd: '/x', demande: demande() });
    expect(t).toContain('`ssh pi`');
    expect(t).not.toContain('`ssh tour`');
    expect(t).toContain('jamais sur `pi` ni `vps`');
  });

  test('machine isolée (vps) : aucune autre machine', () => {
    const t = composerConsignes({
      machine: 'vps',
      cwd: '/x',
      demande: demande({ parc: [{ id: 'vps', description: 'VPS', racines: [] }] }),
    });
    expect(t).toContain('Aucune autre machine');
  });
});
