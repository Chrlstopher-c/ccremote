import { describe, expect, test } from 'bun:test';
import type { Charte } from '../../commun/charte.ts';
import { reglagesParDefaut } from '../../commun/invites.ts';
import { membresVisibles } from './vue-federation.ts';

const CHEF = 'aaaaaaaaaaaa';
const INVITE = 'bbbbbbbbbbbb';
const AUTRE_INVITE = 'cccccccccccc';
// Seuls chefs et membres sont lus par membresVisibles (via reglagesInviteDe).
const charte = {
  chefs: [CHEF],
  membres: [
    { id: CHEF, nom: 'chef' },
    { id: INVITE, nom: 'invité', invite: reglagesParDefaut(CHEF) },
  ],
} as unknown as Charte;
const annuaire = [{ id: CHEF }, { id: AUTRE_INVITE }, { id: INVITE }];

describe('membres proposés à l’appli', () => {
  test('un invité ne voit que son chef, jamais les autres machines du propriétaire', () => {
    expect(membresVisibles(annuaire, charte, INVITE).map((m) => m.id)).toEqual([CHEF]);
  });

  test('ses machines-relais restent visibles (sa session passe par elles)', () => {
    const relais = 'dddddddddddd';
    const avecRelais = {
      ...charte,
      membres: [{ id: CHEF, nom: 'chef' }, { id: INVITE, nom: 'invité', invite: reglagesParDefaut(relais) }],
    } as unknown as Charte;
    expect(membresVisibles([...annuaire, { id: relais }], avecRelais, INVITE).map((m) => m.id)).toEqual([CHEF, relais]);
  });

  test('le chef (ou une machine hors charte) voit tout l’annuaire', () => {
    expect(membresVisibles(annuaire, charte, CHEF)).toHaveLength(3);
    expect(membresVisibles(annuaire, null, INVITE)).toHaveLength(3);
  });
});
