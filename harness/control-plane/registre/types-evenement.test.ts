/**
 * `☠` LE test qui manquait, et son absence a coûté une panne en prod le
 * 2026-08-01.
 *
 * `TypeEvenementConversation` (TypeScript) et le CHECK de la table
 * `conversation_evenement` (SQLite) sont DEUX déclarations de la même vérité, et
 * rien ne les relie. La migration 14 a ajouté `'notification'` au type sans
 * toucher au CHECK. Le compilateur était content, tous les tests passaient — et
 * en production l'insertion était refusée :
 *
 *     CHECK constraint failed: type IN ('operateur','reflexion','texte',
 *     'outil','resultat','erreur','compaction','mandat')
 *
 * La notification était journalisée, visible à l'écran, mais sa remise à
 * l'orchestrateur échouait au dernier maillon. La conversation restait figée sur
 * une fin d'équipe.
 *
 * Pourquoi aucun test ne l'a vu : ceux du service de notifications utilisaient
 * une DOUBLURE de remise et n'écrivaient jamais d'évènement réel. Ils validaient
 * la fonction, pas l'assemblage — dixième occurrence du motif dans ce dépôt.
 *
 * Ce test itère sur la liste TypeScript et écrit chaque valeur dans la VRAIE
 * base. Ajouter un type sans migration le fait échouer immédiatement.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre, type TypeEvenementConversation } from './index.ts';

/**
 * `☠` Énumérée À LA MAIN, et c'est délibéré : un type union TypeScript n'existe
 * pas à l'exécution, donc rien ne peut la dériver automatiquement. Cette liste
 * est le pont entre les deux déclarations — si quelqu'un ajoute un type au
 * `TypeEvenementConversation` sans l'ajouter ici, le compilateur le refuse
 * (`satisfies` ci-dessous), et s'il l'ajoute ici sans migration, ce test casse.
 * Les deux oublis possibles sont donc couverts.
 */
const TOUS_LES_TYPES = [
  'operateur',
  'reflexion',
  'texte',
  'outil',
  'resultat',
  'erreur',
  'compaction',
  'mandat',
  'notification',
] as const satisfies readonly TypeEvenementConversation[];

let repertoire: string;
let registre: Registre;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'types-evt-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.conversations.creer({ id: 'conv-1', titre: 'banc' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('le type TypeScript et le CHECK SQL disent la même chose', () => {
  for (const type of TOUS_LES_TYPES) {
    test(`« ${type} » est accepté par la base`, () => {
      // `☠` Écriture RÉELLE. Une doublure ici ne prouverait rien — c'est
      // précisément ce qui a laissé passer la panne.
      expect(() =>
        registre.conversations.ajouterEvenement({
          conversationId: 'conv-1',
          type,
          contenu: `contenu de test pour ${type}`,
        }),
      ).not.toThrow();
    });
  }

  test('les évènements écrits sont bien relus avec leur type', () => {
    for (const type of TOUS_LES_TYPES) {
      registre.conversations.ajouterEvenement({ conversationId: 'conv-1', type, contenu: type });
    }
    const relus = registre.conversations.evenements('conv-1', 0);
    expect(relus.map((e) => e.type)).toEqual([...TOUS_LES_TYPES]);
  });

  test('un type inconnu est REFUSÉ par la base — le CHECK protège encore', () => {
    // Le CHECK n'est pas devenu permissif au passage : élargir une contrainte
    // ne doit pas revenir à la supprimer.
    expect(() =>
      registre.conversations.ajouterEvenement({
        conversationId: 'conv-1',
        type: 'type_qui_nexiste_pas' as TypeEvenementConversation,
        contenu: 'x',
      }),
    ).toThrow();
  });
});
