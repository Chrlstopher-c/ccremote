/**
 * L'outil bout à bout, contre un vrai registre : ce qui compte n'est pas
 * seulement le verdict rendu, mais ce qui a — ou n'a pas — été écrit en base.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { demanderRallongeAutonomie } from './outils-rallonge.ts';

let registre: Registre;
const FIL = 'conv-1';

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.conversations.creer({ id: FIL, titre: 'Nouvelle conversation' });
});

afterEach(() => registre.fermer());

describe('demander_rallonge_autonomie', () => {
  test('écrit une demande en attente et ne relance rien elle-même', () => {
    const r = demanderRallongeAutonomie(registre, FIL, '80', 'chantier de 60 équipes restantes');
    expect(r.ok).toBe(true);
    const attente = registre.rallonges.enAttente(FIL);
    expect(attente).toHaveLength(1);
    expect(attente[0]?.plafondDemande).toEqual({ type: 'valeur', max: 80 });
    // Rien n'est appliqué au fil par le seul fait de demander.
    expect(registre.conversations.lire(FIL)?.plafondAutonomie).toEqual({ type: 'herite' });
  });

  test('accepte « illimite »', () => {
    const r = demanderRallongeAutonomie(registre, FIL, 'illimite', 'fenêtre de nuit longue');
    expect(r.ok).toBe(true);
    expect(registre.rallonges.enAttente(FIL)[0]?.plafondDemande).toEqual({ type: 'illimite' });
  });

  test('☠ valeur invalide : refus SANS aucune écriture en base', () => {
    const r = demanderRallongeAutonomie(registre, FIL, 'beaucoup', 'motif');
    expect(r.ok).toBe(false);
    expect(registre.rallonges.enAttente(FIL)).toHaveLength(0);
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });

  test('☠ « herite » refusé — une demande doit demander quelque chose', () => {
    const r = demanderRallongeAutonomie(registre, FIL, '', 'motif');
    expect(r.ok).toBe(false);
    expect(registre.rallonges.enAttente(FIL)).toHaveLength(0);
  });

  test('☠ une seconde demande est refusée tant que la première attend', () => {
    const premiere = demanderRallongeAutonomie(registre, FIL, '80', 'premier motif');
    expect(premiere.ok).toBe(true);
    const premierId = registre.rallonges.enAttente(FIL)[0]?.id;

    const seconde = demanderRallongeAutonomie(registre, FIL, '120', 'second motif');
    expect(seconde.ok).toBe(false);
    // La raison porte l'identifiant de celle qui attend déjà.
    expect(seconde.raison).toContain(premierId);
    // Toujours une seule demande en base — la seconde n'a rien écrit.
    expect(registre.rallonges.enAttente(FIL)).toHaveLength(1);
  });

  test('une nouvelle demande redevient possible une fois la précédente tranchée', () => {
    demanderRallongeAutonomie(registre, FIL, '80', 'premier motif');
    const id = registre.rallonges.enAttente(FIL)[0]?.id;
    expect(id).toBeDefined();
    registre.rallonges.trancher(id as string, 'refusee', "refusée par l'opérateur");

    const suivante = demanderRallongeAutonomie(registre, FIL, '120', 'second motif');
    expect(suivante.ok).toBe(true);
    expect(registre.rallonges.enAttente(FIL)).toHaveLength(1);
  });

  test('sans conversation rattachée, refus net et aucune exception', () => {
    const r = demanderRallongeAutonomie(registre, null, '80', 'motif');
    expect(r.ok).toBe(false);
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });
});
