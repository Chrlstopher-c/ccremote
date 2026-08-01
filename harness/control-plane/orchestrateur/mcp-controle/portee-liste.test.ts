/**
 * Ce que `lister_equipes` montre, et surtout ce qu'il ne montre PAS.
 *
 * `☠` Constat de Chris le 01/08, sur une capture d'écran : dans une conversation
 * NEUVE, l'outil déversait quinze équipes terminées appartenant à d'autres fils,
 * chacune avec son mandat complet. « C'est une nouvelle discussion, c'est censé
 * être individuel. »
 *
 * `☠` Vrai pour l'HISTORIQUE, faux pour le VIVANT — et cette nuance est la
 * raison d'être de ces tests. Le parc est une ressource partagée : H-56
 * n'autorise qu'une équipe active par projet, le plafond de parc et la fenêtre
 * de quota sont communs à tous les fils. Un orchestrateur qui ne verrait pas
 * l'équipe lancée depuis un AUTRE fil proposerait un mandat sur un projet déjà
 * occupé — refusé en 409 après coup, ou pire : il conclurait que le projet est
 * libre et le dirait à Chris.
 *
 * Le cloisonnement porte donc sur le bruit, jamais sur ce qui engage une décision.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { listerEquipes } from './outils-inspection.ts';

const FIL_A = 'conv-a';
const FIL_B = 'conv-b';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc1' });
  registre.lots.creer({ id: 'lot-1', intention: 'x' });
  // ☠ Un projet ne porte qu'UNE mission active (H-56, contrainte UNIQUE en base) :
  // on termine avant de réutiliser le même projet. Le montage suit donc la vraie
  // vie du parc, il ne la contourne pas.
  registre.missions.creer({ id: 'finieAAA-1111-4111-8111-111111111111', lotId: 'lot-1', nom: 'vieux chantier A', projet: 'alpha', compteId: 'compte1', conversationId: FIL_A });
  registre.etats.appliquerEtatHarness('finieAAA-1111-4111-8111-111111111111', 'terminee');
  registre.missions.creer({ id: 'finieBBB-2222-4222-8222-222222222222', lotId: 'lot-1', nom: 'vieux chantier B', projet: 'beta', compteId: 'compte1', conversationId: FIL_B });
  registre.etats.appliquerEtatHarness('finieBBB-2222-4222-8222-222222222222', 'terminee');
  // L'active vit sur son PROPRE projet, et elle est lancée depuis le fil A.
  registre.missions.creer({ id: 'activeAA-3333-4333-8333-333333333333', lotId: 'lot-1', nom: 'chantier en cours', projet: 'gamma', compteId: 'compte1', conversationId: FIL_A });
});

afterEach(() => registre.fermer());

describe('cloisonnement par fil', () => {
  test('☠ un fil neuf ne voit PAS l’historique des autres fils', () => {
    // Le défaut signalé par Chris : quinze équipes d'autres conversations
    // déversées dans un fil qui vient de s'ouvrir.
    const r = listerEquipes(registre, { conversationId: FIL_B });
    expect(r.etat).toContain('finieBBB');
    expect(r.etat).not.toContain('finieAAA');
  });

  test('☠ mais il voit TOUTES les actives, y compris celles d’un autre fil', () => {
    // Sans ça il proposerait un mandat sur `alpha`, déjà occupé (H-56) : refusé
    // en 409 après coup, ou pire — il croirait le projet libre.
    const r = listerEquipes(registre, { conversationId: FIL_B });
    expect(r.etat).toContain('activeAA-3333-4333-8333-333333333333');
    expect(r.etat).toContain('tout le parc');
  });

  test('`portee: "parc"` rouvre l’historique complet, sur demande explicite', () => {
    const r = listerEquipes(registre, { conversationId: FIL_B, portee: 'parc' });
    expect(r.etat).toContain('finieAAA');
    expect(r.etat).toContain('finieBBB');
  });

  test('sans identité de fil, la portée retombe sur le parc — jamais sur du vide', () => {
    // Un serveur de contrôle assemblé sans `conversationId` filtrerait sur
    // `null` et ne rendrait RIEN. Mieux vaut trop que rien : une liste vide se
    // lit comme « aucune équipe n'a jamais tourné ».
    const r = listerEquipes(registre, {});
    expect(r.etat).toContain('finieAAA');
    expect(r.etat).toContain('finieBBB');
  });

  test('un fil sans historique le DIT, et dit comment voir le reste', () => {
    const r = listerEquipes(registre, { conversationId: 'conv-neuve' });
    expect(r.etat).toContain('aucune équipe terminée dans CE fil');
    expect(r.etat).toContain('portee="parc"');
  });
});

describe('filtres d’état et volume', () => {
  test('`etat: "actives"` ne rend que le vivant — le cas le plus fréquent', () => {
    const r = listerEquipes(registre, { conversationId: FIL_A, etat: 'actives' });
    expect(r.etat).toContain('activeAA-3333-4333-8333-333333333333');
    expect(r.etat).not.toContain('finieAAA');
  });

  test('`etat: "terminees"` ne rend que l’historique', () => {
    const r = listerEquipes(registre, { conversationId: FIL_A, etat: 'terminees' });
    expect(r.etat).toContain('finieAAA');
    expect(r.etat).not.toContain('activeAA-3333-4333-8333-333333333333');
  });

  test('☠ la limite est bornée et le reste est ANNONCÉ, jamais coupé en silence', () => {
    for (let i = 0; i < 6; i += 1) {
      const id = `m-vieille-${i}`;
      registre.missions.creer({ id, lotId: 'lot-1', nom: `chantier ${i}`, projet: `projet-${i}`, compteId: 'compte1', conversationId: FIL_A });
      registre.etats.appliquerEtatHarness(id, 'terminee');
    }
    const r = listerEquipes(registre, { conversationId: FIL_A, limite: 2 });
    expect(r.etat).toContain('plus anciennes');
  });

  test('☠ le nom d’une équipe est TRONQUÉ dans une liste', () => {
    // Le mandat entier de quinze équipes est un pavé que personne ne lit, et qui
    // coûte du contexte à chaque appel — c'est ce que Chris a vu à l'écran.
    const long = 'A'.repeat(120);
    registre.missions.creer({ id: 'm-long', lotId: 'lot-1', nom: long, projet: 'delta', compteId: 'compte1', conversationId: FIL_A });
    registre.etats.appliquerEtatHarness('m-long', 'terminee');
    const r = listerEquipes(registre, { conversationId: FIL_A, etat: 'terminees' });
    expect(r.etat).not.toContain(long);
    expect(r.etat).toContain('…');
  });
});
