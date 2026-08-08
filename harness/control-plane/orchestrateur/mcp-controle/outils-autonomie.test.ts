/**
 * Les outils bout à bout, contre un vrai registre : ce qui compte n'est pas
 * seulement le verdict rendu, mais ce qui a — ou n'a pas — été écrit en base.
 *
 * `☠` Le test central est en NÉGATIF : une extension déguisée en ajustement doit
 * être refusée, et le refus doit nommer la valeur acceptable. La garde porte sur
 * la VALEUR, jamais sur le nom de l'outil appelé — sans ça, « ajuster » devient
 * le contournement d'« étendre » en une ligne de prompt.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { ajusterAutonomie, demanderFenetreAutonomie, terminerAutonomie } from './outils-autonomie.ts';

let registre: Registre;
const FIL = 'conv-1';
const MAINTENANT = Date.parse('2026-08-08T12:00:00Z');
const HEURE = 3_600_000;
const PARC = 40;

/** Pose une fenêtre déjà ouverte, comme si Chris l'avait validée. */
function poserFenetre(finDansHeures: number, objectif = 'finir la migration'): number {
  const fin = MAINTENANT + finDansHeures * HEURE;
  registre.conversations.poserFenetreAutonomie(FIL, MAINTENANT - HEURE, fin, objectif);
  return fin;
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.conversations.creer({ id: FIL, titre: 'Nouvelle conversation' });
});

afterEach(() => registre.fermer());

describe('demander_fenetre_autonomie — une demande, jamais une ouverture', () => {
  test('☠ écrit une demande en attente et n’ouvre RIEN sur le fil', () => {
    const r = demanderFenetreAutonomie(registre, FIL, '+8h', 'terminer la migration 29', 'maintenant', MAINTENANT);
    expect(r.ok).toBe(true);
    expect(r.effet).toBe('differe');

    const attente = registre.rallonges.enAttente(FIL);
    expect(attente).toHaveLength(1);
    expect(attente[0]?.fenetreFin).toBe(MAINTENANT + 8 * HEURE);
    expect(attente[0]?.fenetreObjectif).toBe('terminer la migration 29');
    // ☠ Une demande de plage ne demande PAS de plafond : la colonne reste vide,
    // sinon l'accorder figerait un fil qui héritait du défaut de parc.
    expect(attente[0]?.plafondDemande).toBeNull();

    const conv = registre.conversations.lire(FIL);
    expect(conv?.autonomieDebut).toBeNull();
    expect(conv?.autonomieFin).toBeNull();
  });

  test('☠ instant invalide : refus SANS aucune écriture en base', () => {
    const r = demanderFenetreAutonomie(registre, FIL, 'demain matin', 'objectif', 'maintenant', MAINTENANT);
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('+8h');
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });

  test('☠ une plage de trois mois est refusée avant écriture', () => {
    const r = demanderFenetreAutonomie(registre, FIL, '+90j', 'chantier long', 'maintenant', MAINTENANT);
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('14 jours');
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });

  test('☠ une fenêtre qui se termine avant de commencer est refusée', () => {
    const r = demanderFenetreAutonomie(registre, FIL, '+2h', 'objectif', '+6h', MAINTENANT);
    expect(r.ok).toBe(false);
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });

  test('une seconde demande est refusée tant que la première attend', () => {
    demanderFenetreAutonomie(registre, FIL, '+8h', 'premier objectif', 'maintenant', MAINTENANT);
    const premierId = registre.rallonges.enAttente(FIL)[0]?.id;
    const seconde = demanderFenetreAutonomie(registre, FIL, '+10h', 'second objectif', 'maintenant', MAINTENANT);
    expect(seconde.ok).toBe(false);
    expect(seconde.raison).toContain(premierId);
    expect(registre.rallonges.enAttente(FIL)).toHaveLength(1);
  });

  test('une demande qui ne ferait que resserrer est renvoyée vers l’outil direct', () => {
    poserFenetre(8);
    const r = demanderFenetreAutonomie(registre, FIL, '+2h', 'objectif', 'maintenant', MAINTENANT);
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('ajuster_autonomie');
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });

  test('sans conversation rattachée, refus net et aucune exception', () => {
    const r = demanderFenetreAutonomie(registre, null, '+8h', 'objectif', 'maintenant', MAINTENANT);
    expect(r.ok).toBe(false);
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });
});

describe('ajuster_autonomie — resserrer part seul', () => {
  test('avancer l’échéance écrit tout de suite, sans demande', () => {
    poserFenetre(8);
    const r = ajusterAutonomie(registre, FIL, PARC, { fin: '+2h' }, MAINTENANT);
    expect(r.ok).toBe(true);
    expect(registre.conversations.lire(FIL)?.autonomieFin).toBe(MAINTENANT + 2 * HEURE);
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });

  test('☠ avancer l’échéance ne perd PAS l’objectif confié par Chris', () => {
    poserFenetre(8, 'ne pas toucher au déploiement');
    ajusterAutonomie(registre, FIL, PARC, { fin: '+2h' }, MAINTENANT);
    expect(registre.conversations.lire(FIL)?.autonomieObjectif).toBe('ne pas toucher au déploiement');
  });

  test('changer l’objectif seul laisse les bornes intactes', () => {
    const fin = poserFenetre(8);
    const r = ajusterAutonomie(registre, FIL, PARC, { objectif: 'consolider au lieu de lancer' }, MAINTENANT);
    expect(r.ok).toBe(true);
    const conv = registre.conversations.lire(FIL);
    expect(conv?.autonomieObjectif).toBe('consolider au lieu de lancer');
    expect(conv?.autonomieFin).toBe(fin);
  });

  test('baisser le plafond sous l’effectif de parc part seul', () => {
    const r = ajusterAutonomie(registre, FIL, PARC, { plafond: '10' }, MAINTENANT);
    expect(r.ok).toBe(true);
    expect(registre.conversations.lire(FIL)?.plafondAutonomie).toEqual({ type: 'valeur', max: 10 });
  });

  test('un appel vide est refusé plutôt que rendu comme un succès', () => {
    expect(ajusterAutonomie(registre, FIL, PARC, {}, MAINTENANT).ok).toBe(false);
  });
});

// ☠ LE TEST QUI COMPTE. Chacun de ces appels est une extension écrite avec le
// nom de l'outil « qui n'étend pas ». Si l'un d'eux passe, la garde n'existe
// pas : il suffirait d'une ligne de prompt pour se rallonger sa propre laisse.
describe('☠ ajuster_autonomie — une extension déguisée en ajustement est refusée', () => {
  test('repousser l’échéance : refusé, et le refus nomme la valeur acceptable', () => {
    const fin = poserFenetre(8);
    const r = ajusterAutonomie(registre, FIL, PARC, { fin: '+20h' }, MAINTENANT);
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('STRICTEMENT antérieure');
    expect(r.raison).toContain('demander_fenetre_autonomie');
    // Rien n'a bougé : ni la fenêtre, ni une demande créée en douce.
    expect(registre.conversations.lire(FIL)?.autonomieFin).toBe(fin);
    expect(registre.rallonges.enAttente()).toHaveLength(0);
  });

  test('monter le plafond : refusé, et le refus donne la borne et l’outil', () => {
    const r = ajusterAutonomie(registre, FIL, PARC, { plafond: '100' }, MAINTENANT);
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('40');
    expect(r.raison).toContain('demander_rallonge_autonomie');
    expect(registre.conversations.lire(FIL)?.plafondAutonomie).toEqual({ type: 'herite' });
  });

  test('« illimite » par le chemin de l’ajustement : refusé', () => {
    const r = ajusterAutonomie(registre, FIL, PARC, { plafond: 'illimite' }, MAINTENANT);
    expect(r.ok).toBe(false);
    expect(registre.conversations.lire(FIL)?.plafondAutonomie).toEqual({ type: 'herite' });
  });

  test('ouvrir une fenêtre là où il n’y en a aucune : refusé', () => {
    const r = ajusterAutonomie(registre, FIL, PARC, { fin: '+8h' }, MAINTENANT);
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('demander_fenetre_autonomie');
    expect(registre.conversations.lire(FIL)?.autonomieFin).toBeNull();
  });

  test('☠ un volet qui étend fait refuser l’appel ENTIER, y compris son volet légitime', () => {
    const fin = poserFenetre(8);
    const r = ajusterAutonomie(registre, FIL, PARC, { fin: '+2h', plafond: '100' }, MAINTENANT);
    expect(r.ok).toBe(false);
    // Le resserrement de l'échéance était valide : il ne doit PAS avoir été
    // écrit. Un ajustement à moitié appliqué laisse un état que personne n'a
    // décidé, et que le refus rendu ne décrit pas.
    expect(registre.conversations.lire(FIL)?.autonomieFin).toBe(fin);
    expect(registre.conversations.lire(FIL)?.plafondAutonomie).toEqual({ type: 'herite' });
  });
});

describe('terminer_autonomie', () => {
  test('ferme la plage et laisse le plafond intact', () => {
    poserFenetre(8);
    registre.conversations.reglerPlafondAutonomie(FIL, { type: 'valeur', max: 12 });
    const r = terminerAutonomie(registre, FIL, MAINTENANT);
    expect(r.ok).toBe(true);
    const conv = registre.conversations.lire(FIL);
    expect(conv?.autonomieDebut).toBeNull();
    expect(conv?.autonomieFin).toBeNull();
    expect(conv?.autonomieObjectif).toBeNull();
    expect(conv?.plafondAutonomie).toEqual({ type: 'valeur', max: 12 });
  });

  test('☠ sans fenêtre : refus, jamais un succès muet', () => {
    const r = terminerAutonomie(registre, FIL, MAINTENANT);
    expect(r.ok).toBe(false);
    expect(r.raison).toContain('rien à fermer');
  });
});
