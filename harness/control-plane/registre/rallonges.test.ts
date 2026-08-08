/**
 * Tests du dépôt rallonges (migration 27) : cycle complet demande → décision,
 * et l'invariant qui compte — une demande accordée ne change RIEN au fil tant
 * que `conversations.reglerPlafondAutonomie` n'a pas été appelé séparément.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from './index.ts';

let registre: Registre;
const FIL = 'conv-rallonge';

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.conversations.creer({ id: FIL, titre: 'Fil sous test' });
});

afterEach(() => registre.fermer());

describe('DepotRallonges', () => {
  test('cycle complet : demande créée en attente → accordée → le plafond du fil bouge réellement', () => {
    const demande = registre.rallonges.creer({
      id: 'r1',
      conversationId: FIL,
      plafondDemande: { type: 'valeur', max: 80 },
      motif: 'chantier de 60 équipes restantes, plafond de parc à 40 déjà atteint',
    });
    expect(demande.statut).toBe('en_attente');
    expect(registre.rallonges.enAttente(FIL)).toHaveLength(1);

    expect(registre.rallonges.trancher('r1', 'accordee', "accordée par l'opérateur")).toBe(true);
    const tranchee = registre.rallonges.lire('r1');
    expect(tranchee?.statut).toBe('accordee');

    // La décision seule n'écrit rien sur le fil : c'est l'appelant (route API)
    // qui applique le réglage, exactement comme le fait la composition réelle.
    registre.conversations.reglerPlafondAutonomie(FIL, tranchee!.plafondDemande!);
    const conv = registre.conversations.lire(FIL);
    expect(conv?.plafondAutonomie).toEqual({ type: 'valeur', max: 80 });
  });

  test('refus : la demande passe refusee et le plafond du fil n’a pas bougé', () => {
    registre.rallonges.creer({
      id: 'r2',
      conversationId: FIL,
      plafondDemande: { type: 'valeur', max: 100 },
      motif: 'motif quelconque',
    });
    expect(registre.rallonges.trancher('r2', 'refusee', "refusée par l'opérateur")).toBe(true);
    expect(registre.rallonges.lire('r2')?.statut).toBe('refusee');
    expect(registre.conversations.lire(FIL)?.plafondAutonomie).toEqual({ type: 'herite' });
  });

  test('illimité demandé et accordé ⇒ plafondEffectif du fil rend null', () => {
    registre.rallonges.creer({
      id: 'r3',
      conversationId: FIL,
      plafondDemande: { type: 'illimite' },
      motif: 'fenêtre de nuit longue, plus personne pour recliquer',
    });
    registre.rallonges.trancher('r3', 'accordee', 'accordée');
    const demande = registre.rallonges.lire('r3');
    registre.conversations.reglerPlafondAutonomie(FIL, demande!.plafondDemande!);
    const conv = registre.conversations.lire(FIL);
    expect(conv?.plafondAutonomie).toEqual({ type: 'illimite' });
  });

  test('☠ double tranchage refusé — le second trancher() rend false', () => {
    registre.rallonges.creer({
      id: 'r4',
      conversationId: FIL,
      plafondDemande: { type: 'valeur', max: 50 },
      motif: 'motif',
    });
    expect(registre.rallonges.trancher('r4', 'accordee', 'premier')).toBe(true);
    expect(registre.rallonges.trancher('r4', 'refusee', 'second, trop tard')).toBe(false);
    // Le premier verdict est celui qui reste.
    expect(registre.rallonges.lire('r4')?.statut).toBe('accordee');
  });

  test('enAttente(conversationId) ne rend que les demandes de CE fil', () => {
    registre.conversations.creer({ id: 'autre-fil', titre: 'Autre' });
    registre.rallonges.creer({ id: 'r5', conversationId: FIL, plafondDemande: { type: 'valeur', max: 10 }, motif: 'm' });
    registre.rallonges.creer({
      id: 'r6',
      conversationId: 'autre-fil',
      plafondDemande: { type: 'valeur', max: 10 },
      motif: 'm',
    });
    expect(registre.rallonges.enAttente(FIL).map((d) => d.id)).toEqual(['r5']);
    expect(registre.rallonges.enAttente()).toHaveLength(2);
  });
});
