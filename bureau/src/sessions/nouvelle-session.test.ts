import { describe, expect, test } from 'bun:test';
import { projetLibre } from './emplacement.ts';

describe('projetLibre', () => {
  test('~ par défaut, nommé « maison » ; sinon le dernier dossier', () => {
    expect(projetLibre('tour', '')).toEqual({ machine: 'tour', chemin: '~', nom: 'maison' });
    expect(projetLibre('tour', '~')).toEqual({ machine: 'tour', chemin: '~', nom: 'maison' });
    expect(projetLibre('pi', '/mnt/hdd/echo/ ')).toEqual({ machine: 'pi', chemin: '/mnt/hdd/echo/', nom: 'echo' });
    expect(projetLibre('portable', '~/projects/flix')).toEqual({
      machine: 'portable',
      chemin: '~/projects/flix',
      nom: 'flix',
    });
  });
});
