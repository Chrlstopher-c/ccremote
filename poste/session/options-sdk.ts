// Responsabilité : les options du Claude Agent SDK d'une session ccremote (dossier, reprise, consignes, modèle,
// environnement épuré, permissions, serveur de rythme). Pur : le binaire, le compte, le serveur de rythme et canUseTool
// viennent de l'appelant.
import type { CanUseTool, McpStdioServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';

// Hérité d'une session Claude parente (messagerie, identité de session) : le CLI enfant le prendrait pour le sien.
// Liste mesurée dans essais/sdk/RAPPORT.md. ANTHROPIC_API_KEY : abonnement uniquement.
const VARIABLES_RETIREES: ReadonlySet<string> = new Set([
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_PID',
  'CLAUDE_AGENT_SDK_VERSION',
  'ANTHROPIC_API_KEY',
]);

export function envSdk(source: Record<string, string | undefined>, configDir: string | null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(source)) {
    if (valeur !== undefined && !VARIABLES_RETIREES.has(cle)) env[cle] = valeur;
  }
  if (configDir) env['CLAUDE_CONFIG_DIR'] = configDir;
  return env;
}

export interface ParametresSdk {
  readonly identifiant: string; // conversation nouvelle (sessionId) ou reprise (resume)
  readonly reprise: boolean;
  readonly cwd: string;
  readonly consignes: string;
  readonly modele: string | undefined;
  readonly executable: string | null; // le claude installé ; null : binaire embarqué au SDK
  readonly configDir: string | null;
  readonly source: Record<string, string | undefined>;
  readonly rythme: McpStdioServerConfig; // le même serveur d'outils de rythme que les sessions tmux
  readonly canUseTool: CanUseTool;
}

export function optionsSdk(p: ParametresSdk): Options {
  return {
    cwd: p.cwd,
    env: envSdk(p.source, p.configDir),
    ...(p.reprise ? { resume: p.identifiant } : { sessionId: p.identifiant }),
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(p.consignes ? { append: p.consignes } : {}) },
    includePartialMessages: true,
    permissionMode: 'default',
    canUseTool: p.canUseTool,
    mcpServers: { ccremote: p.rythme },
    ...(p.modele ? { model: p.modele } : {}),
    ...(p.executable ? { pathToClaudeCodeExecutable: p.executable } : {}),
  };
}
