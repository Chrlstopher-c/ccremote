/**
 * Tests de composition des `Options` de l'orchestrateur — LA preuve mécanique
 * de l'acceptation (a) : « ni Bash, ni Write, ni Edit ». Testés EN NÉGATIF,
 * comme l'exige la mission : on prouve l'absence, pas seulement la présence
 * du reste.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { creerServeurMcpControle, UTILISATION_PARC_DESACTIVEE, type DependancesServeurControle } from '../mcp-controle/index.ts';
import {
  assertInvariantsOrchestrateur,
  composerOptionsOrchestrateur,
  OptionsOrchestrateurError,
  OUTILS_INTERDITS_ORCHESTRATEUR,
  OUTILS_ORCHESTRATEUR,
} from './options-orchestrateur.ts';
import type { DecisionDemarrage } from './identite.ts';

let registre: Registre;
let depsServeur: DependancesServeurControle;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  depsServeur = {
    registre,
    repertoireProjets: '/tmp/options-orchestrateur-test-inexistant',
    // Désactivation explicite du plafond de parc (H-74), jamais une omission.
    utilisationParc: UTILISATION_PARC_DESACTIVEE,
    configPlafondParc: {},
    escalades: { enAttente: () => [], repondre: () => true },
    cibles: { cible: () => null },
    arreteur: { arreter: async () => {} },
    relanceur: { relancer: async () => {} },
    budget: { definir: async () => {} },
  };
});

afterEach(() => {
  registre.fermer();
});

const decisionFroide: DecisionDemarrage = { sessionId: '11111111-1111-4111-8111-111111111111', mode: 'demarrage_froid' };

describe('composerOptionsOrchestrateur — acceptation (a)', () => {
  test('tools est un tableau explicite, JAMAIS le preset complet', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(Array.isArray(options.tools)).toBe(true);
  });

  test('Bash, Write, Edit et Agent sont ABSENTS de tools', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    for (const interdit of ['Bash', 'Write', 'Edit', 'Agent']) {
      expect(options.tools).not.toContain(interdit);
    }
  });

  test('Bash, Write, Edit et Agent sont dans disallowedTools — défense en profondeur', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    for (const interdit of OUTILS_INTERDITS_ORCHESTRATEUR) {
      expect(options.disallowedTools).toContain(interdit);
    }
  });

  test('le serveur MCP de contrôle est bien la seule surface d’action mutative', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(Object.keys(options.mcpServers ?? {})).toHaveLength(1);
  });

  test('☠ un tools reconstruit à la main avec Bash lève à l’assertion', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    const truque = { ...options, tools: [...OUTILS_ORCHESTRATEUR, 'Bash'] };
    expect(() => assertInvariantsOrchestrateur(truque)).toThrow(OptionsOrchestrateurError);
  });

  test('☠ disallowedTools amputé (sans Write) lève à l’assertion', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    const truque = { ...options, disallowedTools: options.disallowedTools?.filter((t) => t !== 'Write') };
    expect(() => assertInvariantsOrchestrateur(truque)).toThrow(OptionsOrchestrateurError);
  });
});

describe('composerOptionsOrchestrateur — identité (b)', () => {
  test('démarrage à froid pose sessionId, jamais resume', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(options.sessionId).toBe(decisionFroide.sessionId);
    expect(options.resume).toBeUndefined();
  });

  test('reprise pose resume, jamais sessionId', () => {
    const decisionReprise: DecisionDemarrage = { sessionId: decisionFroide.sessionId, mode: 'reprise' };
    const options = composerOptionsOrchestrateur({ decision: decisionReprise, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(options.resume).toBe(decisionFroide.sessionId);
    expect(options.sessionId).toBeUndefined();
  });
});

describe('composerOptionsOrchestrateur — désambiguïsation native (d)', () => {
  test('AskUserQuestion est présent dans tools', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(options.tools).toContain('AskUserQuestion');
  });

  test('☠ permissionMode dontAsk refuserait AskUserQuestion — l’assertion le rejette', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    const truque = { ...options, permissionMode: 'dontAsk' as const };
    expect(() => assertInvariantsOrchestrateur(truque)).toThrow(OptionsOrchestrateurError);
  });

  test('☠ AskUserQuestion retiré de tools lève à l’assertion', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    const truque = { ...options, tools: (options.tools as string[]).filter((t) => t !== 'AskUserQuestion') };
    expect(() => assertInvariantsOrchestrateur(truque)).toThrow(OptionsOrchestrateurError);
  });
});

describe('composerOptionsOrchestrateur — (e) aucun flux brut de sous-agent (H-45)', () => {
  test('forwardSubagentText/agentProgressSummaries jamais activés par défaut', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(options.forwardSubagentText).not.toBe(true);
    expect(options.agentProgressSummaries).not.toBe(true);
  });

  test('☠ activer forwardSubagentText à la main lève à l’assertion', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    const truque = { ...options, forwardSubagentText: true };
    expect(() => assertInvariantsOrchestrateur(truque)).toThrow(OptionsOrchestrateurError);
  });
});

describe('composerOptionsOrchestrateur — H-44 (config machine honorée)', () => {
  test('settingSources inclut user/project/local', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(options.settingSources).toEqual(['user', 'project', 'local']);
  });

  test('☠ settingSources vide lève à l’assertion', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    const truque = { ...options, settingSources: [] };
    expect(() => assertInvariantsOrchestrateur(truque)).toThrow(OptionsOrchestrateurError);
  });

  test('systemPrompt en forme preset claude_code, jamais autre chose', () => {
    const options = composerOptionsOrchestrateur({ decision: decisionFroide, serveurControle: creerServeurMcpControle(depsServeur) });
    expect(options.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
  });
});
