// Responsabilité : le cadre d'une session d'invité côté poste — options SDK dérivées du seul cadre (pas de Bash,
// pas de serveur MCP, mode default, configuration Claude dédiée), environnement épuré, consignes, filtre des
// commandes permises et jeton du compte du chef. Le crochet et la permission viennent de confinement-invite.ts.
import type { CanUseTool, HookCallbackMatcher, Options } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import { CadreInvite } from '../../commun/cadre-invite.ts';
import type { DemandeSession, EffortSession, ModeSession } from '../../commun/session.ts';
import { OUTILS_INVITE_INTERDITS, OUTILS_TERMINAL } from '../../commun/invites-outils.ts';
import { terminalPermis } from './confinement-invite.ts';
import { BLOC_PRESENTATION } from './consignes.ts';
import { lireJetonFichier } from '../comptes/lecture-compte.ts';
import { envSdk } from './options-sdk.ts';

export type { CadreInvite };

export const MESSAGE_JETON_INVITE = 'Le compte Claude du chef doit se reconnecter (jeton expiré)';
export const MESSAGE_REMOTE_CONTROL_INVITE = 'Remote Control non permis pour une session d’invité';

const PREFIXES_RETIRES: readonly string[] = ['ANTHROPIC_', 'CLAUDE_CODE_'];
const VARIABLE_SSH = 'SSH_AUTH_SOCK';

// Commandes que Chris (ou le nœud) peut adresser à une session d'invité. Tout le reste est refusé : lire le fil
// (historique), dupliquer, annexer, mode, style, connecteurs, mode nuit, outils de machine…
const COMMANDES_INVITE: ReadonlySet<string> = new Set([
  'envoyer',
  'interrompre',
  'repondre',
  'compacter',
  'fermer',
  'reprendre',
  'autonomie',
  'renommer',
  'modele',
  'effort',
  'prompt_systeme',
  'contexte',
  'connecteurs',
  'taches',
  'tache',
]);

function retiree(cle: string): boolean {
  return cle === VARIABLE_SSH || PREFIXES_RETIRES.some((prefixe) => cle.startsWith(prefixe));
}

/**
 * Environnement épuré du poste, sans variables d'authentification ni de session Claude. Avec un relais (cadre.relais),
 * Claude Code pointe vers le nœud local et n'a aucun identifiant ; sinon il reçoit le jeton du compte du chef.
 */
export function envInvite(
  source: Record<string, string | undefined>,
  cadre: CadreInvite,
  jeton: string | null,
): Record<string, string> {
  const env = envSdk(source, cadre.config);
  for (const cle of Object.keys(env)) if (retiree(cle)) delete env[cle];
  if (cadre.relais !== undefined) {
    return {
      ...env,
      ANTHROPIC_BASE_URL: cadre.relais.url,
      ANTHROPIC_AUTH_TOKEN: cadre.relais.jeton,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
  }
  return jeton === null ? env : { ...env, CLAUDE_CODE_OAUTH_TOKEN: jeton };
}

const ligne = (texte: string | null | undefined): string => (texte ?? '').trim();

/** Consignes d'une session d'invité : ligne d'espace, prompt de la conversation, puis le prompt du chef en dernier. */
export function consignesInvite(cadre: CadreInvite, promptSysteme: string | null): string {
  // Sur sa propre machine (par le relais) : ses outils de Noctis sont là, ils sont décrits comme pour toute session.
  const local = cadre.relais !== undefined;
  const espace = local
    ? `# Session Noctis\nTu travailles dans le dossier ${cadre.espace}, sur l'ordinateur de l'utilisateur.`
    : `Tu travailles dans le dossier ${cadre.espace} ; tu n'as pas accès au reste de la machine.`;
  return [espace, local ? BLOC_PRESENTATION : '', ligne(promptSysteme), ligne(cadre.prompt)]
    .filter((bloc) => bloc.length > 0)
    .join('\n\n');
}

export interface ParametresInvite {
  readonly identifiant: string; // conversation nouvelle (sessionId) ou reprise (resume)
  readonly reprise: boolean;
  readonly reprisePoint?: string | null; // rembobinage : la reprise part de cette entrée
  readonly cadre: CadreInvite;
  readonly promptSysteme: string | null; // prompt de la conversation (la commande prompt_systeme le change)
  readonly jeton: string | null; // jeton d'accès du compte du chef (null : session par le relais du nœud)
  readonly source: Record<string, string | undefined>;
  readonly executable: string | null;
  readonly modele: string | undefined;
  readonly effort: EffortSession | null;
  readonly mode?: ModeSession; // mode de permission choisi par l'invité (sur sa machine seulement)
  readonly confinement: HookCallbackMatcher; // crochet PreToolUse : refuse tout appel hors du cadre
  readonly canUseTool: CanUseTool; // même vérification, pour les outils soumis à permission
  /** Serveurs d'outils de Noctis (artefacts, visuels, rythme) : seulement pour une session sur la machine de l'invité. */
  readonly serveurs?: NonNullable<Options['mcpServers']>;
}

/** Options du SDK d'une session d'invité : rien n'en vient du corps de la demande, seulement du cadre. */
export function optionsInvite(p: ParametresInvite): Options {
  return {
    cwd: p.cadre.espace,
    env: envInvite(p.source, p.cadre, p.jeton),
    ...(p.reprise ? { resume: p.identifiant } : { sessionId: p.identifiant }),
    ...(p.reprise && p.reprisePoint ? { resumeSessionAt: p.reprisePoint } : {}),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: consignesInvite(p.cadre, p.promptSysteme) },
    includePartialMessages: true,
    // Sur sa machine, l'invité choisit son mode (Manuel par défaut, 23/11) ; chez le chef, toujours « default ».
    permissionMode: p.cadre.relais !== undefined ? (p.mode ?? 'default') : 'default',
    // Chez lui, il peut passer en « Ignorer les permissions » en cours de session : le SDK l'exige dès le lancement.
    // Le crochet de confinement s'applique dans tous les modes (rien hors de son espace).
    ...(p.cadre.relais !== undefined ? { allowDangerouslySkipPermissions: true, promptSuggestions: true } : {}),
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: p.serveurs ?? {},
    disallowedTools: OUTILS_INVITE_INTERDITS.filter((o) => !terminalPermis(p.cadre) || !OUTILS_TERMINAL.includes(o)),
    hooks: { PreToolUse: [p.confinement] },
    canUseTool: p.canUseTool,
    ...(p.effort ? { effort: p.effort } : {}),
    ...(p.modele ? { model: p.modele } : {}),
    ...(p.executable ? { pathToClaudeCodeExecutable: p.executable } : {}),
  };
}

/**
 * La demande d'ouverture d'un invité, ramenée à ce que son cadre permet : ni rapide, ni Ultracode ; mode « default »,
 * sauf sur sa propre machine où il garde le mode choisi (Manuel par défaut).
 */
export function demandeInvite(d: DemandeSession): DemandeSession {
  const chezLui = d.invite?.relais !== undefined;
  return {
    ...d,
    moteur: 'sdk',
    mode: chezLui ? (d.mode ?? 'default') : 'default',
    rapide: false,
    ultracode: false,
    style_sortie: null,
    bac_a_sable: 'non',
    controle_distant: false,
    pieces: [],
  };
}

/** Refus à l'ouverture d'une session d'invité, avant toute création de fiche ; null si elle peut s'ouvrir. */
export function refusOuvertureInvite(d: DemandeSession): string | null {
  if (!d.invite) return null;
  if (d.controle_distant) return MESSAGE_REMOTE_CONTROL_INVITE;
  if ((d.moteur ?? 'sdk') !== 'sdk') return 'session d’invité : moteur SDK seulement';
  if (d.pieces?.length) return 'session d’invité : pièces jointes non permises';
  return null;
}

/** Refus d'une commande adressée à une session d'invité ; null si elle est permise. */
// Sur la machine de l'invité (session par le relais), c'est lui qui lit : les fichiers que sa session lui présente
// (visuels `afficher_widget`, pièces) s'affichent dans son fil. Chez le chef, ils restent refusés.
const COMMANDES_INVITE_CHEZ_LUI: ReadonlySet<string> = new Set(['fichier_session', 'mode']);

export function refusCommandeInvite(invite: { cadre: CadreInvite } | undefined, kind: string): string | null {
  if (!invite) return null;
  if (kind === 'remote_control') return MESSAGE_REMOTE_CONTROL_INVITE;
  if (COMMANDES_INVITE.has(kind)) return null;
  if (invite.cadre.relais !== undefined && COMMANDES_INVITE_CHEZ_LUI.has(kind)) return null;
  return `commande non permise pour une session d’invité : ${kind}`;
}

/**
 * Le jeton donné au SDK pour une session d'invité : null si le cadre passe par le relais du nœud (le jeton du chef ne
 * quitte pas le chef), le jeton du compte sinon, undefined s'il manque (la session ne démarre pas).
 */
export function jetonPourInvite(
  cadre: CadreInvite,
  configCompte: string | null,
  journal: Logger,
): string | null | undefined {
  if (cadre.relais !== undefined) return null;
  return jetonInvite(configCompte, journal) ?? undefined;
}

/** Jeton d'accès du compte du chef ; absent, illisible ou expiré : null (session en erreur, rien n'est copié). */
export function jetonInvite(configCompte: string | null, journal: Logger): string | null {
  try {
    return lireJetonFichier(configCompte);
  } catch (erreur) {
    journal.warn({ err: erreur }, 'jeton du compte du chef illisible pour une session d’invité');
    return null;
  }
}
