// Cache des nœuds distants : en mémoire, visible hors ligne, effacé à la révocation, fil borné.
import { describe, expect, test } from 'bun:test';
import { TAILLE_FIL_FEDERE } from '../../commun/federation.ts';
import { ficheDe } from './banc-federation.ts';
import { CacheDistant } from './distant.ts';

const M = 'a1b2c3d4e5f6';

describe('cache des nœuds distants', () => {
  test('les sessions restent visibles hors ligne jusqu’au retrait du nœud', () => {
    const c = new CacheDistant();
    c.connaitre(M, 'portable');
    c.instantane(M, 'portable', 'portable', [ficheDe('s1', 'portable', 'Titre')]);
    expect(c.sessions()).toHaveLength(1);
    c.enLigne(M, false);
    expect(c.sessions()[0]?.enLigne).toBe(false);
    c.retirer(M);
    expect(c.sessions()).toEqual([]);
  });

  test('le fil reste borné aux derniers événements', () => {
    const c = new CacheDistant();
    for (let i = 0; i < TAILLE_FIL_FEDERE + 5; i++) {
      c.ajouterEvenement(M, 's1', { ts: `t${i}`, evt: { type: 'message', texte: `${i}` } });
    }
    const fil = c.fil(M, 's1');
    expect(fil).toHaveLength(TAILLE_FIL_FEDERE);
    expect(fil[fil.length - 1]?.ts).toBe(`t${TAILLE_FIL_FEDERE + 4}`);
  });
});
