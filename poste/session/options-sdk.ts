// Responsabilité : les options du Claude Agent SDK d'une session ccremote (dossier, reprise, consignes, modèle,
// environnement épuré, permissions, serveur de rythme). Pur : le binaire, le compte, le serveur de rythme et canUseTool
// viennent de l'appelant.
import type {
  CanUseTool,
  McpSdkServerConfigWithInstance,
  McpStdioServerConfig,
  Options,
  SandboxSettings,
} from '@anthropic-ai/claude-agent-sdk';
import type { BacASable, EffortSession, ModeSession } from '../../commun/session.ts';

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
  readonly reprisePoint?: string | null; // rembobinage : la reprise part de cette entrée (resumeSessionAt)
  readonly cwd: string;
  readonly consignes: string;
  readonly modele: string | undefined;
  readonly mode: ModeSession;
  readonly effort: EffortSession | null;
  readonly executable: string | null; // le claude installé ; null : binaire embarqué au SDK
  readonly configDir: string | null;
  readonly source: Record<string, string | undefined>;
  readonly rythme: McpStdioServerConfig; // le même serveur d'outils de rythme que les sessions tmux
  readonly canUseTool: CanUseTool;
  readonly outils?: McpSdkServerConfigWithInstance; // serveur `lanterne` : présentation de fichiers, artefacts, widgets
  readonly hooks?: Options['hooks']; // crochets des éditions (poste/modifications), sans effet sur les permissions
  readonly style?: string | null; // style de sortie, réappliqué au démarrage comme à la reprise
  readonly bacASable?: BacASable; // absent ou `non` : pas de sandbox
  readonly interdits?: readonly string[]; // outils retirés de la session (conversation annexe)
}

// `oui` : Bash sandboxé et auto-approuvé dans le bac ; `strict` : et aucune commande hors du bac.
function sandboxDe(mode: Exclude<BacASable, 'non'>): SandboxSettings {
  return {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    ...(mode === 'strict' ? { allowUnsandboxedCommands: false } : {}),
  };
}

export function optionsSdk(p: ParametresSdk): Options {
  return {
    cwd: p.cwd,
    env: { ...envSdk(p.source, p.configDir), CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
    ...(p.reprise ? { resume: p.identifiant } : { sessionId: p.identifiant }),
    ...(p.reprise && p.reprisePoint ? { resumeSessionAt: p.reprisePoint } : {}),
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(p.consignes ? { append: p.consignes } : {}) },
    includePartialMessages: true,
    permissionMode: p.mode,
    // Requis par le SDK pour passer en bypass (en cours de session comme au démarrage) : choix explicite de Lanterne.
    allowDangerouslySkipPermissions: true,
    ...(p.effort ? { effort: p.effort } : {}),
    canUseTool: p.canUseTool,
    mcpServers: { ccremote: p.rythme, ...(p.outils ? { lanterne: p.outils } : {}) },
    ...(p.modele ? { model: p.modele } : {}),
    ...(p.hooks ? { hooks: p.hooks } : {}),
    ...(p.executable ? { pathToClaudeCodeExecutable: p.executable } : {}),
    ...(p.style ? { settings: { outputStyle: p.style } } : {}),
    ...(p.bacASable && p.bacASable !== 'non' ? { sandbox: sandboxDe(p.bacASable) } : {}),
    ...(p.interdits?.length ? { disallowedTools: [...p.interdits] } : {}),
  };
}
