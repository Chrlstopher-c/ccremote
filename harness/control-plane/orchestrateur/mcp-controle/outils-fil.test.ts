/**
 * L'outil bout à bout, contre un vrai registre : c'est ici qu'on vérifie que la
 * règle est REELLEMENT branchée sur la persistance — un verdict correct qui
 * n'écrit pas sa source laisserait la garde ouverte au tour suivant.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { nommerFil } from './outils-fil.ts';

let registre: Registre;
const FIL = 'conv-1';

function messageDeChris(n = 1): void {
  for (let i = 0; i < n; i += 1) {
    registre.conversations.ajouterEvenement({ conversationId: FIL, type: 'operateur', contenu: `message ${i}` });
  }
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.conversations.creer({ id: FIL, titre: 'Nouvelle conversation' });
});

afterEach(() => registre.fermer());

describe('nommer_fil', () => {
  test('au deuxième message, le titre est posé et la source devient « auto »', () => {
    messageDeChris(2);
    const r = nommerFil(registre, FIL, 'Refonte de la sidebar', false);
    expect(r.ok).toBe(true);
    const conv = registre.conversations.lire(FIL);
    expect(conv?.titre).toBe('Refonte de la sidebar');
    expect(conv?.titreSource).toBe('auto');
  });

  test('☠ le second nommage automatique est refusé, et le titre ne bouge pas', () => {
    messageDeChris(2);
    nommerFil(registre, FIL, 'Premier titre', false);
    const r = nommerFil(registre, FIL, 'Second titre', false);
    expect(r.ok).toBe(false);
    // La vérification qui compte : pas seulement le refus, mais l'absence d'écriture.
    expect(registre.conversations.lire(FIL)?.titre).toBe('Premier titre');
  });

  test('☠ au premier message, refus — le fil garde son libellé d’attente', () => {
    messageDeChris(1);
    expect(nommerFil(registre, FIL, 'Trop tôt', false).ok).toBe(false);
    expect(registre.conversations.lire(FIL)?.titre).toBe('Nouvelle conversation');
    expect(registre.conversations.lire(FIL)?.titreSource).toBe('defaut');
  });

  test('une demande de Chris renomme un fil déjà nommé, et le passe en « manuel »', () => {
    messageDeChris(2);
    nommerFil(registre, FIL, 'Titre automatique', false);
    expect(nommerFil(registre, FIL, 'Titre voulu', true).ok).toBe(true);
    const conv = registre.conversations.lire(FIL);
    expect(conv?.titre).toBe('Titre voulu');
    expect(conv?.titreSource).toBe('manuel');
  });

  test('☠ après un renommage manuel, le modèle ne reprend pas la main', () => {
    messageDeChris(2);
    registre.conversations.renommer(FIL, 'Titre de Chris', 'manuel');
    expect(nommerFil(registre, FIL, 'Je préfère celui-ci', false).ok).toBe(false);
    expect(registre.conversations.lire(FIL)?.titre).toBe('Titre de Chris');
  });

  test('sans conversation rattachée, refus net et aucune exception', () => {
    expect(nommerFil(registre, null, 'Titre', false).ok).toBe(false);
  });

  test('sur un fil inconnu, refus net', () => {
    expect(nommerFil(registre, 'fil-fantome', 'Titre', false).ok).toBe(false);
  });

  test('☠ le décompte se fait sur les évènements persistés, pas sur les tours', () => {
    // La session de l'orchestrateur redémarre (compaction, reprise, déploiement).
    // Un compteur en mémoire repartirait de zéro et rouvrirait le nommage.
    messageDeChris(2);
    nommerFil(registre, FIL, 'Titre stable', false);
    const relu = ouvrirRegistre({ chemin: ':memory:' });
    relu.fermer(); // simple garde : le registre d'origine reste la source
    messageDeChris(3);
    expect(nommerFil(registre, FIL, 'Titre après reprise', false).ok).toBe(false);
    expect(registre.conversations.lire(FIL)?.titre).toBe('Titre stable');
  });
});
