// Responsabilité : tests de la vérification d'une requête relayée au nom d'un ami du duo — la machine visée refuse ce
// qui sort de ses droits d'ami (d'après la charte), le pair relais seul ne suffit pas, une requête sans ami garde la
// règle du pair.
import { describe, expect, test } from 'bun:test';
import { autoriseAmi } from '../../commun/charte-amis.ts';
import { type Charte, TOUS_DROITS } from '../../commun/charte.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { amiDeMessage, requetePermise } from './droits-noeud-requete.ts';

const AMI = 'eeeeeeeeeeee';
const M1 = 'aaaaaaaaaaaa';
const M2 = 'bbbbbbbbbbbb';
const ECRIRE_AMI: MessageChiffre = { t: 'ecrire', ref: 'r1', session: 's1', texte: 'bonjour', ami: AMI };
const ECRIRE: MessageChiffre = { t: 'ecrire', ref: 'r2', session: 's1', texte: 'bonjour' };

const CHARTE: Charte = {
  format: 1,
  reseau: '111111111111',
  nom: 'Parc',
  version: 2,
  chefs: [M1],
  membres: [
    { id: M1, nom: 'tour', sorte: 'pair', identite: 'x', droits: TOUS_DROITS, compte: null },
    { id: M2, nom: 'portable', sorte: 'pair', identite: 'x', droits: TOUS_DROITS, compte: null },
  ],
  le: '2026-11-22T10:00:00.000Z',
  par: M1,
  origine: 'creation',
  amis: [{ ami: AMI, machines: { [M1]: { voir: true, piloter: true, lancer: false, remoteControl: false } } }],
};

describe('requête relayée au nom d un ami du duo', () => {
  test('la machine visée refuse une requête d ami hors de ses droits, permise sur sa ligne', () => {
    const verifie = (machine: string) => (ami: string, r: Parameters<typeof autoriseAmi>[3]) =>
      autoriseAmi(CHARTE, ami, machine, r);
    expect(amiDeMessage(ECRIRE_AMI)).toBe(AMI);
    expect(requetePermise(ECRIRE_AMI, { genre: 'ecrire' }, true, verifie(M2))).toBe(false);
    expect(requetePermise(ECRIRE_AMI, { genre: 'ecrire' }, true, verifie(M1))).toBe(true);
  });

  test('le pair relais sans le droit suffit à refuser, même si l ami est permis', () => {
    expect(requetePermise(ECRIRE_AMI, { genre: 'ecrire' }, false, () => true)).toBe(false);
  });

  test('sans ami, seule la règle du pair s applique (compatibilité)', () => {
    expect(amiDeMessage(ECRIRE)).toBeNull();
    expect(requetePermise(ECRIRE, { genre: 'ecrire' }, true, () => false)).toBe(true);
  });
});
