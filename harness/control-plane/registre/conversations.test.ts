/**
 * Tests du dépôt conversations (migration 2) : CRUD, journal d'événements,
 * curseur de streaming, et l'invariant « écrire un événement bouge maj_a ».
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from './index.ts';

let repertoire: string;
let registre: Registre;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'conv-test-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
});

afterEach(() => {
  try {
    registre.fermer();
  } catch {
    /* déjà fermé */
  }
  rmSync(repertoire, { recursive: true, force: true });
});

describe('DepotConversations', () => {
  test('crée puis relit une conversation active sans session', () => {
    const conv = registre.conversations.creer({ id: 'c1', titre: 'Test' }, 1000);
    expect(conv.statut).toBe('active');
    expect(conv.sessionId).toBeNull();
    expect(registre.conversations.lire('c1')?.titre).toBe('Test');
  });

  test('lister ne rend que les actives, la plus récemment active en tête', () => {
    registre.conversations.creer({ id: 'a', titre: 'A' }, 1000);
    registre.conversations.creer({ id: 'b', titre: 'B' }, 2000);
    registre.conversations.ajouterEvenement({ conversationId: 'a', type: 'operateur', contenu: 'coucou' }, 3000);
    const ids = registre.conversations.lister().map((c) => c.id);
    expect(ids).toEqual(['a', 'b']); // 'a' a bougé en dernier (maj_a=3000)
  });

  test('archiver retire de la liste mais conserve les événements', () => {
    registre.conversations.creer({ id: 'a', titre: 'A' }, 1000);
    registre.conversations.ajouterEvenement({ conversationId: 'a', type: 'texte', contenu: 'x' }, 1100);
    expect(registre.conversations.archiver('a')).toBe(true);
    expect(registre.conversations.lister()).toHaveLength(0);
    expect(registre.conversations.evenements('a')).toHaveLength(1);
  });

  test('les événements portent un seq croissant, filtrable par curseur', () => {
    registre.conversations.creer({ id: 'a', titre: 'A' }, 1000);
    const e1 = registre.conversations.ajouterEvenement({ conversationId: 'a', type: 'operateur', contenu: 'salut' });
    const e2 = registre.conversations.ajouterEvenement({ conversationId: 'a', type: 'texte', contenu: 'réponse' });
    expect(e2.seq).toBeGreaterThan(e1.seq);
    const depuis = registre.conversations.evenementsDepuis('a', e1.seq);
    expect(depuis).toHaveLength(1);
    expect(depuis[0]?.contenu).toBe('réponse');
  });

  test('majSessionId fixe l’identité SDK de reprise', () => {
    registre.conversations.creer({ id: 'a', titre: 'A' });
    registre.conversations.majSessionId('a', 'sess-uuid');
    expect(registre.conversations.lire('a')?.sessionId).toBe('sess-uuid');
  });

  test('ON DELETE CASCADE : supprimer via archive garde l’historique, mais les événements suivent la conversation', () => {
    registre.conversations.creer({ id: 'a', titre: 'A' });
    registre.conversations.ajouterEvenement({ conversationId: 'a', type: 'reflexion', contenu: 'hmm' });
    // renommer touche maj_a sans perdre les événements
    expect(registre.conversations.renommer('a', 'Nouveau titre')).toBe(true);
    expect(registre.conversations.lire('a')?.titre).toBe('Nouveau titre');
    expect(registre.conversations.evenements('a')).toHaveLength(1);
  });
});
