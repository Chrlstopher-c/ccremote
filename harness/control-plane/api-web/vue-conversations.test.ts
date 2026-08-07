/**
 * `☠` Le test qui manquait, et qui vient d'être payé au prix fort le 01/08.
 *
 * Les résultats d'appels d'outils étaient collectés, persistés (migration 21) et
 * vérifiés en base sur la production — mais `versEvenementApi` ne les recopiait
 * pas dans la réponse HTTP. L'interface recevait donc un évènement `outil` sans
 * `resultat`, et affichait « en attente » pour un résultat déjà écrit à côté.
 *
 * Le pire n'est pas l'oubli : c'est qu'il était INVISIBLE. Le typecheck passait
 * (un champ absent du type ne manque à personne), les 1286 tests passaient, la
 * base contenait la bonne donnée. Seule une lecture de la réponse réelle dans le
 * navigateur l'a montré. Douzième variante du motif maison — écrit, testé, et
 * jamais transporté jusqu'au consommateur.
 *
 * D'où cette suite : elle porte sur la FRONTIÈRE, le seul endroit où « la donnée
 * existe » et « la donnée arrive à l'écran » se séparent.
 */

import { describe, expect, test } from 'bun:test';
import { versAutonomieFilApi, versConversationApi, versEvenementApi } from './vue-conversations.ts';
import type { Conversation, EvenementConversation } from '../registre/index.ts';

function evenement(surcharges: Partial<EvenementConversation> = {}): EvenementConversation {
  return {
    seq: 1,
    conversationId: 'conv-a',
    type: 'outil',
    contenu: 'mcp__ccremote-controle__lister_equipes',
    creeA: 1_700_000_000_000,
    modele: 'claude-opus-5',
    effort: 'high',
    toolUseId: 'toolu_1',
    detail: '{"projet":"lumen"}',
    resultat: '{"ok":true}',
    pieces: [],
    ...surcharges,
  };
}

describe('la frontière HTTP transporte ce que la base contient', () => {
  test('☠ `detail` et `resultat` arrivent RÉELLEMENT dans la réponse', () => {
    const api = versEvenementApi(evenement());
    expect(api.detail).toBe('{"projet":"lumen"}');
    expect(api.resultat).toBe('{"ok":true}');
  });

  test('☠ aucun champ attendu par l’écran ne manque', () => {
    // Une liste EXPLICITE plutôt qu'un test champ par champ : c'est elle qui
    // fait échouer l'ajout d'une colonne oubliée en chemin, au lieu de laisser
    // l'écran afficher un vide crédible.
    expect(Object.keys(versEvenementApi(evenement())).sort()).toEqual(
      ['at', 'contenu', 'detail', 'effort', 'model', 'pieces', 'resultat', 'seq', 'type'],
    );
  });

  test('les pièces jointes traversent la frontière avec une URL, jamais un chemin disque', () => {
    const api = versEvenementApi(
      evenement({
        type: 'operateur',
        conversationId: 'conv b',
        pieces: [{ fichier: '170-0-capture.png', nom: 'capture.png', type: 'image/png', taille: 2048 }],
      }),
    );
    expect(api.pieces).toHaveLength(1);
    expect(api.pieces[0]?.nom).toBe('capture.png');
    expect(api.pieces[0]?.taille).toBe(2048);
    // Le navigateur ne peut rien faire d'un chemin sur le Pi — et le publier
    // révélerait l'arborescence du control plane.
    expect(api.pieces[0]?.url).toBe('/api/harness/orchestrator/conversations/conv%20b/pieces/170-0-capture.png');
  });

  test('un message sans pièce rend un tableau vide, jamais `undefined`', () => {
    // `undefined` obligerait chaque appelant du front à se garder — et le
    // premier qui oublierait planterait le rendu du fil entier.
    expect(versEvenementApi(evenement()).pieces).toEqual([]);
  });

  test('un résultat pas encore revenu reste `null`, jamais une chaîne vide', () => {
    // `null` = « l'outil n'a pas encore répondu ». `''` se lirait comme « il a
    // répondu, et sa réponse est vide » — deux états opposés.
    const api = versEvenementApi(evenement({ resultat: null, detail: null }));
    expect(api.resultat).toBeNull();
    expect(api.detail).toBeNull();
  });

  test('l’attribution modèle/effort reste portée par l’évènement', () => {
    const api = versEvenementApi(evenement({ modele: 'claude-sonnet-5', effort: 'medium' }));
    expect(api.model).toBe('claude-sonnet-5');
    expect(api.effort).toBe('medium');
  });
});

/**
 * `☠` Migration 15 (fenêtre d'autonomie) et migration 26 (plafond) écrivaient
 * quatre colonnes que AUCUNE route ne resservait. L'interface, faute de source,
 * affichait « aucune plage » — une affirmation sur une donnée que personne
 * n'avait lue. Ces tests portent sur la même frontière que ceux ci-dessus : le
 * seul endroit où « la donnée existe » et « la donnée arrive à l'écran » se
 * séparent.
 */
function conversation(surcharges: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-a',
    titre: 'nuit du 07',
    titreSource: 'auto',
    sessionId: null,
    statut: 'active',
    creeA: 1_700_000_000_000,
    majA: 1_700_000_100_000,
    compactions: 2,
    resumeContexte: null,
    modele: 'claude-opus-5',
    effort: 'high',
    modeRapide: null,
    autonomieDebut: null,
    autonomieFin: null,
    autonomieObjectif: null,
    plafondAutonomie: { type: 'herite' },
    machine: 'trinityarch',
    ...surcharges,
  };
}

describe('la fenêtre d’autonomie traverse la frontière HTTP', () => {
  test('☠ une plage posée ressort telle quelle — objectif compris', () => {
    const api = versAutonomieFilApi(
      conversation({
        autonomieDebut: 1_700_000_000_000,
        autonomieFin: 1_700_028_800_000,
        autonomieObjectif: 'finir la migration et la tester',
      }),
    );
    expect(api.autonomieDebut).toBe(1_700_000_000_000);
    expect(api.autonomieFin).toBe(1_700_028_800_000);
    // L'objectif est la SEULE chose qui dise à quoi la plage a été déléguée :
    // sans lui l'écran ne montrerait que deux dates.
    expect(api.autonomieObjectif).toBe('finir la migration et la tester');
  });

  test('☠ « hérité », « illimité » et une valeur restent TROIS états distincts', () => {
    // Les confondre afficherait un fil neuf comme délibérément affranchi.
    expect(versAutonomieFilApi(conversation()).plafondAutonomie).toBe('herite');
    expect(versAutonomieFilApi(conversation({ plafondAutonomie: { type: 'illimite' } })).plafondAutonomie)
      .toBe('illimite');
    expect(versAutonomieFilApi(conversation({ plafondAutonomie: { type: 'valeur', max: 12 } })).plafondAutonomie)
      .toBe('12');
  });

  test('un fil absent du registre rend la forme la plus conservatrice, jamais un champ manquant', () => {
    expect(versAutonomieFilApi(null)).toEqual({
      autonomieDebut: null,
      autonomieFin: null,
      autonomieObjectif: null,
      plafondAutonomie: 'herite',
    });
  });

  test('☠ aucun champ attendu par l’écran ne manque à une conversation servie', () => {
    // Même discipline que la liste explicite des évènements : c'est elle qui
    // fait échouer l'ajout d'une colonne oubliée en chemin.
    const api = versConversationApi(
      { id: 'c', titre: 't', creeA: 1, majA: 2, active: true, contextePct: 30, machine: 'vps' },
      versAutonomieFilApi(conversation({ autonomieDebut: 10, autonomieFin: 20 })),
    );
    expect(Object.keys(api).sort()).toEqual([
      'active', 'autonomieDebut', 'autonomieFin', 'autonomieObjectif', 'compactions', 'contextPct',
      'creeA', 'effort', 'id', 'machine', 'majA', 'model', 'plafondAutonomie', 'titre',
    ]);
    expect(api.autonomieFin).toBe(20);
  });
});
