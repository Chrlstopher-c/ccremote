/**
 * Le modèle des modèles — ce qui décide du coût réel d'une équipe.
 *
 * `☠` Défaut mesuré en production le 01/08 : le site lumen a coûté **52,93 $ en
 * six vagues**, aucune sous 3,85 $. Cause : `AgentInput.model` est optionnel et,
 * omis, un sous-agent HÉRITE du modèle du parent — un lead Opus lançant trois
 * sous-agents en lançait trois en Opus, sans l'avoir décidé. La parade d'alors
 * était une CONSIGNE dans les prompts (« ton défaut est sonnet », « choisis le
 * modèle de l'équipe »).
 *
 * `☠` VERROU DUR A1 (décision Chris 2026-09-03) : la consigne est remplacée par
 * une hiérarchie imposée. Le lead est verrouillé sur Opus 4.8 (`dispatch-mandat.ts`),
 * ses sous-agents sur Sonnet (`workers/modele-sous-agents.ts`), et l'orchestrateur
 * ne choisit plus rien. Ces tests gardent donc l'invariant INVERSE de la version
 * précédente : les prompts doivent dire la VÉRITÉ sur la hiérarchie imposée —
 * le lead qu'il ne choisit pas le modèle de ses sous-agents, l'orchestrateur
 * qu'il ne choisit pas celui de l'équipe. Un prompt qui promet un choix que le
 * code retire est le même « écrit, branché sur rien » que ce dépôt a déjà payé.
 */

import { describe, expect, test } from 'bun:test';
import { composerMandatSysteme } from './dispatch-mandat.ts';
import { MANDAT_ORCHESTRATEUR } from './processus/mandat.ts';
import { MCP_EQUIPE } from '../../workers/mcp-du-poste.ts';
import { NOM_SERVEUR_MCP_DEPENSE } from '../../workers/mcp-depense/serveur.ts';
import type { Proposition } from '../registre/index.ts';

const MANDAT: Proposition = {
  id: 'p1',
  conversationId: 'conv-a',
  projet: 'lumen',
  objectif: 'construire la landing page',
  critereArret: 'le site build et les 10 sections sont en place',
  perimetre: 'src/ uniquement',
  acces: 'ecriture',
  budgetMaxUsd: 0,
  modele: null,
  effort: null,
  latitude: null,
  domaine: null,
  statut: 'en_attente',
  missionId: null,
  detail: null,
  creeA: 0,
  majA: 0,
};

/**
 * `☠` Les valeurs acceptées par l'outil Task du SDK, LUES dans
 * `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` :
 *
 *   model?: "sonnet" | "opus" | "haiku" | "fable"
 *
 * Ce sont des ALIAS. Un identifiant complet (`claude-sonnet-5`) y est refusé.
 * Si une mise à jour du SDK change cette liste, ce test doit être repassé sur le
 * fichier réel — pas ajusté pour redevenir vert.
 */
const ALIAS_SDK = ['sonnet', 'opus', 'haiku', 'fable'] as const;

const mandatSysteme = composerMandatSysteme(MANDAT, 'ecriture');

describe('ce que le lead doit savoir : le modèle des sous-agents est IMPOSÉ (A1)', () => {
  test('☠ on lui DIT que le modèle des sous-agents est verrouillé sur Sonnet', () => {
    // Sans ça, un lead qui écrit `model: opus` sur un Task et voit son sous-agent
    // tourner sur Sonnet le lit comme une panne, et perd des tours à « corriger ».
    expect(mandatSysteme).toContain('TES SOUS-AGENTS TOURNENT SUR SONNET');
    expect(mandatSysteme.toLowerCase()).toContain('imposé');
    expect(mandatSysteme).toContain('`sonnet`');
  });

  test('☠ le cas `fork` est nommé comme refusé — il hériterait de l’Opus du lead', () => {
    // C'est le seul trou du verrou (fork ignore `model`) : le lead doit savoir
    // pourquoi son fork est refusé et quoi faire à la place.
    expect(mandatSysteme).toContain('`fork`');
    expect(mandatSysteme).toContain('refusé');
    // Aucun identifiant complet ne doit apparaître dans la consigne Task — le
    // champ `model` du Task attend un alias (`sonnet`), jamais `claude-sonnet-5`.
    expect(mandatSysteme).not.toContain('`claude-sonnet-5`');
    expect(mandatSysteme).not.toContain('`claude-opus-5`');
    expect(ALIAS_SDK).toContain('sonnet');
  });

  test('☠ la contrepartie de Sonnet reste nommée, et la parade ne coûte rien', () => {
    // Sonnet déclare plus souvent terminé un travail non vérifié : la preuve
    // mécanique est ce qui l'attrape, sans réintroduire le coût d'un modèle cher.
    expect(mandatSysteme).toContain('PREUVE MÉCANIQUE');
    expect(mandatSysteme).toContain('aucun token');
  });

  test('☠ le rôle correctif du lead est présent, avec ses outils d’édition (A1b)', () => {
    // La reprise d'un raté ne passe plus par un second sous-agent Opus (il n'y en
    // a plus) mais par le lead lui-même — c'est un FILET, pas le mode normal.
    expect(mandatSysteme).toContain('TON RÔLE CORRECTIF');
    expect(mandatSysteme).toContain('Write');
    expect(mandatSysteme).toContain('FILET');
  });

  test('le verrou survit à la compaction — il est dans le systemPrompt', () => {
    // `☠` Même raison que le rapport et le budget : le premier message NE survit
    // PAS à une compaction, et un lead compacté relance des sous-agents.
    expect(mandatSysteme).toContain('TES SOUS-AGENTS TOURNENT SUR SONNET');
    expect(mandatSysteme).toContain('TON RÔLE CORRECTIF');
  });
});

/**
 * `☠` LE test d'assemblage, celui qui manquait deux fois. Le 01/08 au matin, le
 * mandat de l'orchestrateur annonçait `WebSearch` absent de son allowlist. Le
 * même jour, on découvrait que le mandat du lead lui ordonnait d'utiliser
 * Playwright alors qu'aucune équipe n'a jamais eu un seul serveur MCP.
 *
 * Deux surfaces différentes, un seul défaut : un prompt qui promet une capacité
 * que rien ne fournit. Un modèle ne peut pas s'en apercevoir — il essaie, échoue,
 * contourne, et brûle des tours à le faire.
 */
describe('☠ tout outil NOMMÉ au lead doit exister réellement', () => {
  // `☠` La liste des serveurs RÉELLEMENT transmis à une équipe n'est plus
  // `MCP_EQUIPE` seule depuis le 18/08 : `ccremote-depense` est un serveur
  // en-process maison (`workers/mcp-depense/serveur.ts`), assemblé directement
  // par `construireWorkerSpec` — jamais lu depuis `~/.claude.json` du poste,
  // donc structurellement absent de `MCP_EQUIPE`. La liste blanche reste
  // FERMÉE : on l'étend nommément, on ne l'ouvre pas.
  const SERVEURS_REELLEMENT_TRANSMIS = [...MCP_EQUIPE, NOM_SERVEUR_MCP_DEPENSE];

  test('chaque serveur MCP cité dans le mandat est bien transmis aux équipes', () => {
    // On lit les serveurs cités sous la forme `mcp__<serveur>__*` dans le prompt,
    // et on exige que chacun figure dans la liste réellement transmise.
    const cites = [...mandatSysteme.matchAll(/mcp__([a-z-]+)__/g)].map((m) => m[1]);
    expect(cites.length).toBeGreaterThan(0);
    for (const serveur of cites) {
      expect(SERVEURS_REELLEMENT_TRANSMIS).toContain(serveur as string);
    }
  });

  test('les serveurs transmis qui servent la validation E2E sont bien annoncés', () => {
    // L'inverse du test précédent : un outil fourni mais jamais nommé est un
    // outil que le lead n'utilisera pas — payé, et inutile.
    for (const serveur of ['codeindex', 'playwright', 'log-watcher']) {
      expect(mandatSysteme).toContain(`mcp__${serveur}__`);
    }
  });

  test('☠ l’outil de consultation de sa propre dépense est bien annoncé (mandat 18/08)', () => {
    // Le second livrable du mandat : un outil que le modèle ignore n'existe pas
    // pour lui. Sans cette ligne, `ccremote-depense` serait transmis mais jamais
    // cité — exactement le motif « écrit, testé, branché sur rien ».
    expect(mandatSysteme).toContain(`mcp__${NOM_SERVEUR_MCP_DEPENSE}__ma_depense`);
  });

  test('☠ l’écriture en mémoire sémantique est cadrée par H-66', () => {
    // Elle est PARTAGÉE avec l'humain et les autres équipes. Une équipe qui y
    // attribue à Chris une décision de l'orchestrateur pose un faux qui lui
    // survit — H-66 appliqué à un support persistant.
    expect(mandatSysteme).toContain('PARTAGÉE');
    expect(mandatSysteme).toContain('n’attribue JAMAIS');
  });
});

describe('ce que l’orchestrateur doit savoir : il n’arbitre PLUS le modèle (verrou A1)', () => {
  test('☠ l’ancienne interdiction d’arbitrer n’est pas revenue', () => {
    // Le texte exact qu'il citait le 01/08 en refusant de choisir — il ne doit
    // pas reparaître, mais l'arbitrage qui l'avait remplacé disparaît à son tour.
    expect(MANDAT_ORCHESTRATEUR).not.toContain('laisse \\`modele\\` et \\`effort\\` vides');
    expect(MANDAT_ORCHESTRATEUR).not.toContain('ne choisis JAMAIS un modèle inférieur');
  });

  test('☠ on lui DIT que le modèle de l’équipe est verrouillé, et qu’il ne le choisit pas', () => {
    // Sinon il propose des `modele`/`effort` que le dispatch ignore, et Chris
    // croit piloter un réglage qui n'a plus d'effet.
    expect(MANDAT_ORCHESTRATEUR).toMatch(/verrouill/i);
    expect(MANDAT_ORCHESTRATEUR.toLowerCase()).toContain('tu n’as pas à le choisir'.toLowerCase());
  });

  test('☠ la hiérarchie imposée est nommée : Opus 4.8 au lead, Sonnet aux exécuteurs', () => {
    expect(MANDAT_ORCHESTRATEUR).toContain('Opus 4.8');
    expect(MANDAT_ORCHESTRATEUR).toContain('Sonnet');
    // Il n'écrit plus d'identifiant de modèle : le champ ne sert plus.
    expect(MANDAT_ORCHESTRATEUR).not.toContain('claude-sonnet-5');
    expect(MANDAT_ORCHESTRATEUR).not.toContain('claude-opus-5');
  });

  test('☠ une demande humaine d’un autre modèle est renvoyée au bon niveau, pas fausse­ment appliquée', () => {
    // Le verrou est dur : même Chris ne change pas le modèle d'équipe via
    // `creer_equipe`. L'orchestrateur doit le dire, pas faire semblant.
    expect(MANDAT_ORCHESTRATEUR).toMatch(/ne fais pas semblant de l’appliquer/i);
    expect(MANDAT_ORCHESTRATEUR).toContain('master');
  });
});
