// Responsabilité : la ligne de commande `claude` d'une session pilotée par ccremote (lancement ou reprise).
// La session garde TOUTE la config de Chris (CLAUDE.md, skills, MCP) : on n'ajoute que consignes, crochets et rythme.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const VAR_SESSION = 'CCREMOTE_SESSION';
export const VAR_SOCKET = 'CCREMOTE_SOCKET';

const CROCHET = join(import.meta.dir, 'crochet.ts');
const MCP_RYTHME = join(import.meta.dir, 'mcp-rythme.ts');

export interface Lancement {
  readonly sessionId: string;
  readonly titre: string;
  readonly consignes: string;
  readonly modele: string | null;
  readonly reprise: boolean;
}

export function binaireClaude(): string {
  const candidats = [process.env['CCREMOTE_CLAUDE'], join(homedir(), '.bun/bin/claude'), join(homedir(), '.local/bin/claude')];
  return candidats.find((c): c is string => !!c && existsSync(c)) ?? 'claude';
}

function crochets(): string {
  const commande = (evenement: string) => [{ type: 'command', command: `${process.execPath} ${CROCHET} ${evenement}`, timeout: 30 }];
  return JSON.stringify({
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

export function commandeClaude(l: Lancement): string[] {
  return [
    binaireClaude(),
    ...(l.reprise ? ['--resume', l.sessionId] : ['--session-id', l.sessionId, '--name', l.titre]),
    '--dangerously-skip-permissions',
    '--append-system-prompt', l.consignes,
    '--settings', crochets(),
    '--mcp-config', rythme(),
    ...(l.modele ? ['--model', l.modele] : []),
  ];
}
