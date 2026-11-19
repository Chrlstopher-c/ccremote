import { describe, expect, test } from 'bun:test';
import { ficheImportee } from './importation.ts';

const NOUVEAU = 'c0000000-0000-4000-8000-000000000002';

describe('fiche d une session découverte ouverte', () => {
  test('fermée, reprenable par le SDK, historique lu dans son transcript', () => {
    const fiche = ficheImportee(
      { machine: 'tour', compte: 'principal', fenetre: 200_000 },
      {
        id: NOUVEAU,
        machine: 'tour',
        cwd: '/travail/projet',
        chemin: '/x',
        configDir: null,
        titre: 'Titre',
        modifieLe: '2026-11-18T10:00:00.000Z',
        branche: 'main',
        messages: 4,
      },
    );
    expect(fiche).toMatchObject({
      id: NOUVEAU,
      statut: 'fermee',
      moteur: 'sdk',
      claudeSessionId: NOUVEAU,
      cwd: '/travail/projet',
    });
  });
});
