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
import { VAR_SESSION_PILOTEE } from '../presentation/socket-outils.ts';
import { environnementNav } from '../nav/environnement.ts';
import { NOM_SERVEUR_CONNECTEURS } from './outils-connecteurs.ts';

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
  readonly session: string; // id de la session Noctis : LANTERNE_SESSION_PILOTEE, réclamée par la CLI noctis-nav
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
  readonly connecteurs?: McpSdkServerConfigWithInstance; // réactivation par l'agent des connecteurs coupés
  readonly hooks?: Options['hooks']; // crochets des éditions (poste/modifications), sans effet sur les permissions
  readonly style?: string | null; // style de sortie, réappliqué au démarrage comme à la reprise
  readonly rapide?: boolean; // mode rapide demandé : réglage `fastMode` du calque, réappliqué à la reprise
  readonly ultracode?: boolean; // Ultracode demandé : réglage de session, non persisté par le SDK
  readonly bacASable?: BacASable; // absent ou `non` : pas de sandbox
  readonly interdits?: readonly string[]; // outils retirés de la session (conversation annexe)
}

// Calque de réglages de `query()` : style, mode rapide, Ultracode. Absent si aucun n'est demandé.
function reglagesDeCalque(p: ParametresSdk): CalqueReglages | undefined {
  const reglages: CalqueReglages = {
    ...(p.style ? { outputStyle: p.style } : {}),
    ...(p.rapide ? { fastMode: true } : {}),
    ...(p.ultracode ? { ultracode: true } : {}),
  };
  return Object.keys(reglages).length > 0 ? reglages : undefined;
}

type CalqueReglages = { outputStyle?: string; fastMode?: true; ultracode?: true };

// `oui` : Bash sandboxé et auto-approuvé dans le bac ; `strict` : et aucune commande hors du bac.
function sandboxDe(mode: Exclude<BacASable, 'non'>): SandboxSettings {
  return {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    ...(mode === 'strict' ? { allowUnsandboxedCommands: false } : {}),
  };
}

export function optionsSdk(p: ParametresSdk): Options {
  const calque = reglagesDeCalque(p);
  return {
    cwd: p.cwd,
    env: {
      ...envSdk(p.source, p.configDir),
      CLAUDE_CODE_ENABLE_TODO_TOOLS: '1',
      [VAR_SESSION_PILOTEE]: p.session,
      ...environnementNav(p.source['PATH']),
    },
    ...(p.reprise ? { resume: p.identifiant } : { sessionId: p.identifiant }),
    ...(p.reprise && p.reprisePoint ? { resumeSessionAt: p.reprisePoint } : {}),
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(p.consignes ? { append: p.consignes } : {}) },
    includePartialMessages: true,
    // Réponse probable de Chris après chaque tour, comme Desktop (placeholder de la saisie, Tab pour la prendre).
    promptSuggestions: true,
    permissionMode: p.mode,
    // Requis par le SDK pour passer en bypass (en cours de session comme au démarrage) : choix explicite de Lanterne.
    allowDangerouslySkipPermissions: true,
    ...(p.effort ? { effort: p.effort } : {}),
    canUseTool: p.canUseTool,
    mcpServers: {
      ccremote: p.rythme,
      ...(p.outils ? { lanterne: p.outils } : {}),
      ...(p.connecteurs ? { [NOM_SERVEUR_CONNECTEURS]: p.connecteurs } : {}),
    },
    ...(p.modele ? { model: p.modele } : {}),
    ...(p.hooks ? { hooks: p.hooks } : {}),
    ...(p.executable ? { pathToClaudeCodeExecutable: p.executable } : {}),
    ...(calque ? { settings: calque } : {}),
    ...(p.bacASable && p.bacASable !== 'non' ? { sandbox: sandboxDe(p.bacASable) } : {}),
    ...(p.interdits?.length ? { disallowedTools: [...p.interdits] } : {}),
  };
}
