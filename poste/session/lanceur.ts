// Responsabilité : la ligne de commande d'une session pilotée par ccremote (lancement ou reprise), passée par le
// lanceur unique `cc` : c'est lui qui donne l'id, le nom, la session tmux et la fiche du registre.
// La session garde TOUTE la config de Chris (CLAUDE.md, skills, MCP) : on n'ajoute que consignes, crochets et rythme.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { EffortSession, LanceurSession, ModeSession } from '../../commun/session.ts';

export const VAR_SESSION = 'CCREMOTE_SESSION';
export const VAR_SOCKET = 'CCREMOTE_SOCKET';

const CC = join(import.meta.dir, 'cc');
const CROCHET = join(import.meta.dir, 'crochet.ts');
const MCP_RYTHME = join(import.meta.dir, 'mcp-rythme.ts');

export interface Lancement {
  readonly sessionId: string;
  readonly titre: string;
  readonly consignes: string;
  readonly modele: string | null;
  readonly reprise: boolean;
  readonly mode?: ModeSession | undefined; // absent ou bypassPermissions : défaut de ccremote
  readonly effort?: EffortSession | null | undefined;
}

export function binaireClaude(): string {
  const candidats = [
    process.env['CCREMOTE_CLAUDE'],
    join(homedir(), '.bun/bin/claude'),
    join(homedir(), '.local/bin/claude'),
  ];
  return candidats.find((c): c is string => !!c && existsSync(c)) ?? 'claude';
}

function crochets(): string {
  const commande = (evenement: string) => [
    { type: 'command', command: `${process.execPath} ${CROCHET} ${evenement}`, timeout: 30 },
  ];
  return JSON.stringify({
    // Sans lui, un dossier de config neuf affiche l'avertissement du mode bypass (option par défaut : quitter).
    skipDangerousModePermissionPrompt: true,
    hooks: {
      SessionStart: [{ hooks: commande('SessionStart') }],
      UserPromptSubmit: [{ hooks: commande('UserPromptSubmit') }],
      Stop: [{ hooks: commande('Stop') }],
      PreToolUse: [{ matcher: 'Agent|Task', hooks: commande('PreToolUse') }],
    },
  });
}

function rythme(): string {
  return JSON.stringify({ mcpServers: { ccremote: { type: 'stdio', command: process.execPath, args: [MCP_RYTHME] } } });
}

// Le même serveur de rythme que tmux, lancé par le SDK : la session et le socket passent par l'environnement.
export function serveurRythme(session: string, socket: string): McpStdioServerConfig {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [MCP_RYTHME],
    env: { [VAR_SESSION]: session, [VAR_SOCKET]: socket },
  };
}

// Reprise d'une session adoptée ou fermée : sa config d'origine, sans crochets ; de quoi démarrer sans question.
export function commandeReprise(sessionId: string, lanceur: LanceurSession = 'quart'): string[] {
  return [
    CC, '--lanceur', lanceur, '--id', sessionId, '--',
    '--resume', sessionId,
    '--dangerously-skip-permissions',
    '--settings', JSON.stringify({ skipDangerousModePermissionPrompt: true }),
  ];
}

// `cc` ajoute --session-id et --name à un lancement neuf ; une reprise passe --resume (il reprend le nom et la date).
// `--mcp-config` est variadique : il ne doit pas précéder le message, que l'appelant ajoute en dernier.
export function commandeClaude(l: Lancement): string[] {
  return [
    CC, '--lanceur', 'quart', '--id', l.sessionId, '--nom', l.titre, '--',
    '--mcp-config', rythme(),
    '--settings', crochets(),
    ...permission(l.mode),
    '--append-system-prompt', l.consignes,
    ...(l.modele ? ['--model', l.modele] : []),
    ...(l.effort ? ['--effort', l.effort] : []),
    ...(l.reprise ? ['--resume', l.sessionId] : []),
  ];
}

// Un mode autre que bypass se passe au CLI tel quel (une session SDK repassée au TUI garde son mode).
function permission(mode: ModeSession | undefined): string[] {
  return mode && mode !== 'bypassPermissions' ? ['--permission-mode', mode] : ['--dangerously-skip-permissions'];
}
