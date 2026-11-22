// Routage des messages du protocole : la liaison directe quand elle est ouverte, l'aiguilleur sinon ; un canal reste
// sur son tuyau ; le duo passe toujours par l'aiguilleur. Pur (ports factices).
import { describe, expect, test } from 'bun:test';
import type { MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import { Tuyaux } from './tuyaux.ts';

const ID = 'aaaaaaaaaaaa';
const AUTRE = 'bbbbbbbbbbbb';

function banc(directOuvert: boolean) {
  const aiguilleur: MessageVersAiguilleur[] = [];
  const directs: { membre: string; message: MessageVersAiguilleur }[] = [];
  const tuyaux = new Tuyaux({
    envoyerAiguilleur: (m) => (aiguilleur.push(m), true),
    envoyerDirect: (membre, m) => {
      if (!directOuvert || membre !== ID) return null;
      directs.push({ membre, message: m });
      return true;
    },
  });
  return { tuyaux, aiguilleur, directs };
}

describe('routage des tuyaux', () => {
  test('une ouverture vers un pair à liaison directe ouverte passe par elle', () => {
    const { tuyaux, aiguilleur, directs } = banc(true);
    tuyaux.envoyer({ t: 'ouvrir', canal: 'c1', vers: ID });
    expect(directs).toHaveLength(1);
    expect(aiguilleur).toHaveLength(0);
  });

  test('sans liaison directe, l’ouverture part par l’aiguilleur', () => {
    const { tuyaux, aiguilleur, directs } = banc(false);
    tuyaux.envoyer({ t: 'ouvrir', canal: 'c1', vers: ID });
    expect(directs).toHaveLength(0);
    expect(aiguilleur.map((m) => m.t)).toEqual(['ouvrir']);
  });

  test('un canal reste sur le tuyau qui l’a ouvert, même si la liaison directe tombe', () => {
    const { tuyaux, aiguilleur, directs } = banc(true);
    tuyaux.envoyer({ t: 'ouvrir', canal: 'c1', vers: ID });
    tuyaux.envoyer({ t: 'donnees', canal: 'c1', charge: 'x' });
    expect(directs.map((d) => d.message.t)).toEqual(['ouvrir', 'donnees']);
    expect(aiguilleur).toHaveLength(0);
  });

  test('un canal ouvert par un pair sur sa liaison directe répond par cette liaison', () => {
    const { tuyaux, aiguilleur, directs } = banc(false);
    tuyaux.ouvertParPair('c2', ID);
    tuyaux.envoyer({ t: 'accepter', canal: 'c2' });
    expect(directs.map((d) => d.message.t)).toEqual([]);
    expect(aiguilleur).toHaveLength(0);
  });

  test('le duo passe toujours par l’aiguilleur, même avec une liaison directe ouverte', () => {
    const { tuyaux, aiguilleur, directs } = banc(true);
    tuyaux.envoyer({ t: 'ouvrir', canal: 'duo-x1', vers: ID });
    expect(directs).toHaveLength(0);
    expect(aiguilleur.map((m) => m.t)).toEqual(['ouvrir']);
  });

  test('un pair sans liaison directe ni aiguilleur : l’envoi échoue sans rien retenir', () => {
    const tuyaux = new Tuyaux({ envoyerAiguilleur: () => false, envoyerDirect: () => null });
    expect(tuyaux.envoyer({ t: 'ouvrir', canal: 'c3', vers: AUTRE })).toBe(false);
  });
});
