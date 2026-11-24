// Responsabilité : connecteurs coupés par le réglage de Noctis — coupés au démarrage avant le premier message,
// retenus dans la fiche, réactivables par l'agent (outil `connecteur_activer`).
import { describe, expect, test } from 'bun:test';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { attendre, nouvelleSession } from './faux-sdk.ts';
import { repondre } from './outils-connecteurs.ts';

describe('connecteurs coupés au démarrage', () => {
  test('coupés avant que le premier message parte', async () => {
    const recus: SDKUserMessage[] = [];
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }], {
      messagesRecus: recus,
      resume: { connecteursCoupes: ['claude.ai Gmail', 'claude.ai Shopify'] },
    });
    await session.lancer('bonjour');
    await attendre(() => recus.length === 1);
    expect(requetes[0]?.connecteursBascules).toEqual(['claude.ai Gmail:inactif', 'claude.ai Shopify:inactif']);
  });

  test('une bascule de session est retenue dans la fiche', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('bonjour');
    await attendre(() => session.resume.statut === 'attente');
    expect(await session.basculerConnecteur('claude.ai Gmail', false)).toBeNull();
    expect(session.resume.connecteursCoupes).toEqual(['claude.ai Gmail']);
    expect(await session.basculerConnecteur('claude.ai Gmail', true)).toBeNull();
    expect(session.resume.connecteursCoupes).toEqual([]);
  });
});

describe('outil connecteur_activer', () => {
  const actions = (coupes: string[], activés: string[]) => ({
    coupes: () => coupes,
    activer: async (nom: string) => {
      activés.push(nom);
      return null;
    },
  });
  test('sans nom : la liste ; avec un nom court : le bon connecteur réactivé', async () => {
    const activés: string[] = [];
    const a = actions(['claude.ai Gmail', 'claude.ai Shopify'], activés);
    expect(await repondre(a, undefined)).toContain('claude.ai Gmail, claude.ai Shopify');
    expect(await repondre(a, 'gmail')).toContain('réactivé');
    expect(activés).toEqual(['claude.ai Gmail']);
  });
  test('un connecteur non coupé n’est pas touché', async () => {
    const activés: string[] = [];
    expect(await repondre(actions([], activés), 'Notion')).toContain('pas coupé');
    expect(activés).toEqual([]);
  });
});
