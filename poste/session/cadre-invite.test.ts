// Responsabilité : tests du cadre d'une session d'invité — options SDK dérivées du seul cadre, environnement épuré,
// jeton du chef lu sans copie, ordre des consignes, commandes permises et refus à l'ouverture.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { DemandeSession } from '../../commun/session.ts';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import { avecPromptSysteme } from './consignes.ts';
import {
  consignesInvite,
  demandeInvite,
  envInvite,
  jetonInvite,
  jetonPourInvite,
  optionsInvite,
  refusCommandeInvite,
  refusOuvertureInvite,
} from './cadre-invite.ts';

const journal = pino({ level: 'silent' });
const jetables: string[] = [];

function jetable(): string {
  const dossier = mkdtempSync(join(tmpdir(), 'cadre-invite-test-'));
  jetables.push(dossier);
  return dossier;
}

afterEach(() => {
  for (const dossier of jetables.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

const CADRE: CadreInvite = {
  membre: 'abcdefabcdef',
  nom: 'Elie',
  espace: '/chemin/espace',
  config: '/chemin/config',
  lecture: [],
  prompt: 'Réponds en français.',
  remoteControl: false,
};

function demande(extra: Record<string, unknown> = {}) {
  return DemandeSession.parse({
    sessionId: 'a1b2c3d4-0000-4000-8000-000000000001',
    projet: { machine: 'tour', nom: 'espace', chemin: '/chemin/espace' },
    titre: 'Recherche',
    message: 'Bonjour',
    objectif: null,
    autonomie: false,
    parc: [],
    invite: CADRE,
    ...extra,
  });
}

const FAUSSES_OPTIONS = {
  identifiant: 'a1b2c3d4-0000-4000-8000-000000000001',
  reprise: false,
  cadre: CADRE,
  promptSysteme: null,
  jeton: 'jeton-du-chef',
  source: {},
  executable: null,
  modele: 'haiku',
  effort: 'low' as const,
  confinement: { hooks: [] },
  canUseTool: async () => ({ behavior: 'deny' as const, message: 'non' }),
};

describe('options SDK d’une session d’invité', () => {
  test('aucun outil d’exécution, aucun serveur MCP, aucun réglage de l’utilisateur', () => {
    const o = optionsInvite(FAUSSES_OPTIONS);
    expect(o.settingSources).toEqual([]);
    expect(o.mcpServers).toEqual({});
    expect(o.strictMcpConfig).toBe(true);
    expect(o.disallowedTools).toContain('Bash');
    expect(o.disallowedTools).toContain('Task');
    expect(o.sandbox).toBeUndefined();
    expect(o.cwd).toBe(CADRE.espace);
    expect(o.model).toBe('haiku');
  });

  test('mode imposé default, même si la demande veut bypass ou rapide', () => {
    const d = demandeInvite(demande({ mode: 'bypassPermissions', rapide: true, ultracode: true }));
    expect(d.mode).toBe('default');
    expect(d.rapide).toBe(false);
    expect(d.ultracode).toBe(false);
    expect(optionsInvite(FAUSSES_OPTIONS).permissionMode).toBe('default');
  });

  test('CLAUDE_CONFIG_DIR du cadre, jeton du chef, aucune variable d’authentification du poste', () => {
    const env = envInvite(
      {
        PATH: '/usr/bin',
        HOME: '/home/chef',
        ANTHROPIC_API_KEY: 'sk-ne-doit-pas-passer',
        ANTHROPIC_BASE_URL: 'https://ailleurs.test',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_SSE_PORT: '1234',
        SSH_AUTH_SOCK: '/run/ssh.sock',
      },
      CADRE,
      'jeton-du-chef',
    );
    expect(env['CLAUDE_CONFIG_DIR']).toBe(CADRE.config);
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('jeton-du-chef');
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['SSH_AUTH_SOCK']).toBeUndefined();
    const restantes = Object.keys(env).filter((k) => k.startsWith('ANTHROPIC_') || k.startsWith('CLAUDE_CODE_'));
    expect(restantes.sort()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN']);
  });

  test('cadre avec relais : Claude Code pointe vers le nœud, sans aucun jeton du chef', () => {
    const avecRelais: CadreInvite = {
      ...CADRE,
      relais: { url: 'http://127.0.0.1:1/api/relais-claude', jeton: 'j'.repeat(43) },
    };
    const env = envInvite({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-x' }, avecRelais, null);
    expect(env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:1/api/relais-claude');
    expect(env['ANTHROPIC_AUTH_TOKEN']).toBe('j'.repeat(43));
    expect(env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']).toBe('1');
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  test('pas de jeton à lire quand le cadre passe par le relais', () => {
    const avecRelais: CadreInvite = { ...CADRE, relais: { url: 'http://127.0.0.1:1/x', jeton: 'j'.repeat(43) } };
    expect(jetonPourInvite(avecRelais, jetable(), journal)).toBeNull();
    expect(jetonPourInvite(CADRE, jetable(), journal)).toBeUndefined();
  });

  test('jeton lu du fichier du compte, sans copie ni écriture dans le dossier du compte', () => {
    const compte = jetable();
    writeFileSync(
      join(compte, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-lu', expiresAt: Date.now() + 3_600_000 } }),
    );
    expect(jetonInvite(compte, journal)).toBe('jeton-lu');
    expect(readdirSync(compte)).toEqual(['.credentials.json']);
    expect(jetonInvite(jetable(), journal)).toBeNull();
  });

  test('jeton expiré : null, donc la session ne démarre pas', () => {
    const compte = jetable();
    writeFileSync(
      join(compte, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'vieux', expiresAt: Date.now() - 1000 } }),
    );
    expect(jetonInvite(compte, journal)).toBeNull();
  });
});

describe('consignes d’une session d’invité', () => {
  test('ligne d’espace, puis prompt de la conversation, puis prompt du chef en dernier', () => {
    const texte = consignesInvite(CADRE, 'Ton ton est sobre.');
    const espace = texte.indexOf('Tu travailles dans le dossier /chemin/espace');
    const conversation = texte.indexOf('Ton ton est sobre.');
    const chef = texte.indexOf('Réponds en français.');
    expect(espace).toBe(0);
    expect(conversation).toBeGreaterThan(espace);
    expect(chef).toBeGreaterThan(conversation);
    expect(texte).toContain("n'as pas accès au reste de la machine");
  });

  test('sans prompt de conversation : seulement l’espace et le prompt du chef', () => {
    expect(consignesInvite(CADRE, null).split('\n\n')).toHaveLength(2);
  });

  test('session ordinaire : le prompt de la conversation suit les consignes Lanterne', () => {
    expect(avecPromptSysteme('Consignes Lanterne', 'Prompt conv')).toBe('Consignes Lanterne\n\nPrompt conv');
    expect(avecPromptSysteme('Consignes Lanterne', null)).toBe('Consignes Lanterne');
    expect(avecPromptSysteme('Consignes Lanterne', '   ')).toBe('Consignes Lanterne');
  });
});

describe('commandes et ouverture d’une session d’invité', () => {
  test('lire le fil, dupliquer, mode, style, mode nuit et Remote Control sont refusés', () => {
    const invite = { cadre: CADRE };
    for (const kind of ['historique', 'dupliquer', 'annexer', 'mode', 'style', 'nuit', 'remote_control']) {
      expect(refusCommandeInvite(invite, kind)).not.toBeNull();
    }
  });

  test('envoyer, interrompre, prompt_systeme, modèle et effort sont permis ; une session ordinaire n’est pas filtrée', () => {
    const invite = { cadre: CADRE };
    for (const kind of ['envoyer', 'interrompre', 'prompt_systeme', 'modele', 'effort', 'compacter']) {
      expect(refusCommandeInvite(invite, kind)).toBeNull();
    }
    expect(refusCommandeInvite(undefined, 'historique')).toBeNull();
  });

  test('sur la machine de l’invité (relais), ses visuels et fichiers de session se lisent ; chez le chef, non', () => {
    const chezLui = { cadre: { ...CADRE, relais: { url: 'http://127.0.0.1:1/claude', jeton: 'j'.repeat(32) } } };
    expect(refusCommandeInvite(chezLui, 'fichier_session')).toBeNull();
    expect(refusCommandeInvite(chezLui, 'historique')).not.toBeNull();
    expect(refusCommandeInvite({ cadre: CADRE }, 'fichier_session')).not.toBeNull();
  });

  test('Remote Control refusé même si le chef l’a cochée (la bascule TUI sortirait du cadre)', () => {
    expect(refusOuvertureInvite(demande({ controle_distant: true }))).not.toBeNull();
    expect(refusOuvertureInvite(demande({ moteur: 'tmux' }))).not.toBeNull();
    expect(refusOuvertureInvite(demande())).toBeNull();
  });
});
