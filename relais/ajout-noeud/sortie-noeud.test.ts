// Lecture de la sortie du script distant : valeurs validées, dernière occurrence, message d'échec assaini.
import { expect, test } from 'bun:test';
import { etapeDistante, lireSortie, messageEchec } from './sortie-noeud.ts';

const EMPREINTE = 'ABCD 0123 4567 89EF ABCD 0123 4567 89EF ABCD 0123 4567 89EF ABCD 0123 4567 89EF';

test('lit membre, empreintes et fin', () => {
  const lignes = ['@etape verification', '@membre 0123456789ab', `@empreinte ${EMPREINTE}`];
  const s = lireSortie([...lignes, `@empreinte-pair ${EMPREINTE}`, '@fin'].join('\n'));
  expect(s).toEqual({
    sha: null,
    membre: '0123456789ab',
    empreinte: EMPREINTE,
    empreintePair: EMPREINTE,
    dejaAppaire: false,
    relie: false,
    fin: true,
  });
});

test('valeurs mal formées ignorées', () => {
  const s = lireSortie('@membre 01; id\n@empreinte abcd\n@sha 123');
  expect(s.membre).toBeNull();
  expect(s.empreinte).toBeNull();
  expect(s.sha).toBeNull();
});

test('étapes et marqueurs', () => {
  expect(etapeDistante('@etape bascule')).toBe('bascule');
  expect(etapeDistante('bascule')).toBeNull();
  expect(lireSortie('@relie').relie).toBe(true);
  expect(lireSortie('@deja-appaire\n@fin').dejaAppaire).toBe(true);
});

test('message d’échec sans hôte, utilisateur ni adresse', () => {
  const hote = 'machine.exemple.test';
  const m = messageEchec('@etape unité', `refus chez chris@${hote} (192.0.2.10) sur ${hote}`, hote);
  expect(m).not.toContain('machine.exemple.test');
  expect(m).not.toContain('192.0.2.10');
  expect(m).not.toContain('@etape');
});
