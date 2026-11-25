// La liste fermée des routes relayées : ce qui traverse le lien, et ce qui reste local par nature.
import { describe, expect, test } from 'bun:test';
import { estGesteRelayable, estMethodeRelayable } from './gestes-federes.ts';

describe('estGesteRelayable', () => {
  test('éteindre (fermer) et rallumer (reprendre) une session d’une autre machine passent', () => {
    expect(estGesteRelayable('session', 'fermer')).toBe(true);
    expect(estGesteRelayable('session', 'reprendre')).toBe(true);
  });

  test('synthèse vocale et service de voix : relayés (noeud, dossier de machine) ; sous-chemins refusés', () => {
    expect(estGesteRelayable('noeud', 'voix')).toBe(true);
    expect(estGesteRelayable('noeud', 'voix/service')).toBe(true);
    expect(estGesteRelayable('machine', 'voix')).toBe(true);
    expect(estGesteRelayable('noeud', 'voix/service/x')).toBe(false);
    expect(estGesteRelayable('machine', 'voix/service')).toBe(false);
  });

  test('dictée : transcription et service relayés (noeud), réglage par machine ; sous-chemins refusés', () => {
    expect(estGesteRelayable('noeud', 'dictee')).toBe(true);
    expect(estGesteRelayable('noeud', 'dictee/service')).toBe(true);
    expect(estGesteRelayable('machine', 'dictee')).toBe(true);
    expect(estGesteRelayable('machine', 'dictee/service')).toBe(false);
    expect(estGesteRelayable('noeud', 'dictee/service/x')).toBe(false);
  });

  test('fichiers, git, artefacts, contenu, remote-control, rembobiner et dossiers de machine passent', () => {
    expect(estGesteRelayable('session', 'remote-control')).toBe(true);
    expect(estGesteRelayable('session', 'rembobiner')).toBe(true);
    expect(estGesteRelayable('noeud', 'confirmations/c-1/reponse')).toBe(true);
    expect(estGesteRelayable('session', 'git/commiter')).toBe(true);
    expect(estGesteRelayable('session', 'fichiers/f-1')).toBe(true);
    expect(estGesteRelayable('session', 'artefacts/a-1/supprimer')).toBe(true);
    expect(estGesteRelayable('session', 'contenu')).toBe(true);
    expect(estGesteRelayable('machine', 'dossiers')).toBe(true);
    expect(estGesteRelayable('noeud', 'artefacts')).toBe(true);
  });

  test('ce qui reste local par nature, ou hors liste, est refusé', () => {
    expect(estGesteRelayable('machine', 'comptes')).toBe(false);
    expect(estGesteRelayable('session', 'supprimer')).toBe(false);
    expect(estGesteRelayable('session', 'jetons')).toBe(false);
    expect(estGesteRelayable('session', 'relais')).toBe(false);
    expect(estGesteRelayable('session', 'confirmations/x/reponse')).toBe(false);
    expect(estGesteRelayable('machine', 'eteindre')).toBe(false);
    expect(estGesteRelayable('machine', 'reveiller')).toBe(false);
    expect(estGesteRelayable('session', 'ouvrir')).toBe(false);
    expect(estGesteRelayable('session', 'git')).toBe(false);
    expect(estGesteRelayable('noeud', 'artefacts/a-1/supprimer')).toBe(false);
    expect(estGesteRelayable('session', '../etc')).toBe(false);
  });

  test('mise en fond d une commande d outil : relayée ; autres sous-chemins refusés', () => {
    expect(estGesteRelayable('session', 'outils/toolu_01abc/fond')).toBe(true);
    expect(estGesteRelayable('session', 'outils/toolu_01abc/fond/x')).toBe(false);
    expect(estGesteRelayable('session', 'outils/toolu_01abc')).toBe(false);
    expect(estGesteRelayable('machine', 'outils/toolu_01abc/fond')).toBe(false);
  });

  test('méthodes transportées : GET, POST, PUT', () => {
    expect(['GET', 'POST', 'PUT'].every(estMethodeRelayable)).toBe(true);
    expect(estMethodeRelayable('DELETE')).toBe(false);
  });
});

describe('nom de connecteur encodé', () => {
  test('« claude.ai Hugging Face » passe le lien, un chemin détourné non', () => {
    expect(estGesteRelayable('session', 'connecteurs/claude.ai%20Hugging%20Face')).toBe(true);
    expect(estGesteRelayable('machine', 'connecteurs/claude.ai%20Gmail')).toBe(true);
    expect(estGesteRelayable('session', 'connecteurs/..%2F..%2Fetc')).toBe(true); // encodé : un seul segment, décodé par le pair
    expect(estGesteRelayable('session', 'connecteurs/a/b')).toBe(false);
    expect(estGesteRelayable('session', 'connecteurs/a b')).toBe(false);
  });
});
