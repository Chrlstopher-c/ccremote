import { describe, expect, test } from 'bun:test';
import { manifesteReecrit } from './mises-a-jour-noeud.ts';

describe('manifeste de mise à jour relu par le nœud', () => {
  test('les paquets pointent vers la route du nœud', () => {
    const brut = {
      version: '0.2.1',
      platforms: {
        'linux-x86_64': { url: 'https://aiguilleur.example/maj/Noctis_0.2.1_amd64.AppImage', signature: 's' },
        'windows-x86_64': { url: 'https://aiguilleur.example/maj/Noctis_0.2.1_x64-setup.exe', signature: 's' },
      },
    };
    const lu = manifesteReecrit(brut, 'http://127.0.0.1:4000') as typeof brut;
    expect(lu.platforms['linux-x86_64'].url).toBe('http://127.0.0.1:4000/api/maj/Noctis_0.2.1_amd64.AppImage');
    expect(lu.platforms['windows-x86_64'].url).toBe('http://127.0.0.1:4000/api/maj/Noctis_0.2.1_x64-setup.exe');
  });
  test('un nom de paquet inattendu n’est pas réécrit', () => {
    const brut = { platforms: { x: { url: 'https://e.example/maj/../secret' } } };
    expect((manifesteReecrit(brut, 'http://l') as typeof brut).platforms.x.url).toBe('https://e.example/maj/../secret');
  });
});
