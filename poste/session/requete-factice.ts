// Responsabilité : le moteur de session factice (LANTERNE_SDK_FACTICE=1) — une requête qui répond sans jamais appeler
// Claude ni consommer d'abonnement, pour les bancs d'essai. Elle émet des messages au format du SDK que la vraie
// traduction (session-sdk-traduction.ts) relit : le fil avance comme avec un modèle, sans aucun accès réseau.
import type {
  Options,
  SDKControlGetContextUsageResponse,
  SDKControlGetUsageResponse,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { FileAsynchrone } from './file-messages-sdk.ts';
import type { EnvironnementSdk, FabriqueRequete, RequeteSdk } from './session-sdk.ts';

const MODELE_FACTICE = 'claude-factice';
const MORCEAUX_REPONSE = 15;
const PAUSE_MORCEAU_MS = 150;
const MOT_OUTIL = 'outil';
const COMMANDE_OUTIL = 'echo factice';
const INTERRUPTION = 'Interrompu par Chris';
const USAGE_FACTICE = {
  input_tokens: 1200,
  output_tokens: 40,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
const CONTEXTE_NEUTRE = { model: MODELE_FACTICE, totalTokens: 0, rawMaxTokens: 1_000_000, percentage: 0 };
const USAGE_NEUTRE = {
  session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0 },
  subscription_type: null,
  rate_limits_available: false,
  rate_limits: null,
  behaviors: null,
};

type Objet = Record<string, unknown>;

// Forme du SDK réduite aux champs que la traduction lit : facturation et métadonnées réelles sont omises.
function versSdk(forme: Objet): SDKMessage {
  return forme as unknown as SDKMessage; // justifié : seuls les champs lus par la traduction sont présents
}

function initialisation(session: string, options: Options): SDKMessage {
  return versSdk({
    type: 'system',
    subtype: 'init',
    session_id: session,
    uuid: randomUUID(),
    model: MODELE_FACTICE,
    cwd: options.cwd ?? '',
    permissionMode: options.permissionMode ?? 'default',
    tools: [],
    mcp_servers: [],
    slash_commands: [],
    skills: [],
    plugins: [],
    output_style: 'default',
    apiKeySource: 'none',
    claude_code_version: 'factice',
  });
}

function messageAssistant(session: string, id: string, contenu: Objet[], arret: string): SDKMessage {
  const message = {
    id,
    type: 'message',
    role: 'assistant',
    model: MODELE_FACTICE,
    content: contenu,
    stop_reason: arret,
    usage: USAGE_FACTICE,
  };
  return versSdk({ type: 'assistant', uuid: randomUUID(), session_id: session, parent_tool_use_id: null, message });
}

function evenementFlux(session: string, event: Objet): SDKMessage {
  return versSdk({ type: 'stream_event', event, parent_tool_use_id: null, uuid: randomUUID(), session_id: session });
}

function resultatOutil(session: string, outilId: string): SDKMessage {
  const contenu = [{ type: 'tool_result', tool_use_id: outilId, content: 'factice', is_error: false }];
  return versSdk({
    type: 'user',
    message: { role: 'user', content: contenu },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: session,
  });
}

// Fin de tour : `texte` à null = tour interrompu par Chris (résultat en erreur, comme le SDK).
function resultatTour(session: string, dureeMs: number, texte: string | null): SDKMessage {
  const base = {
    type: 'result',
    duration_ms: dureeMs,
    duration_api_ms: dureeMs,
    num_turns: 1,
    session_id: session,
    uuid: randomUUID(),
    total_cost_usd: 0,
    usage: USAGE_FACTICE,
    permission_denials: [],
  };
  if (texte === null) {
    return versSdk({ ...base, subtype: 'error_during_execution', is_error: true, errors: [INTERRUPTION] });
  }
  return versSdk({ ...base, subtype: 'success', is_error: false, result: texte });
}

// Découpe la réponse en `nombre` morceaux (caractères entiers, jamais une paire coupée).
function morceaux(texte: string, nombre: number): string[] {
  const caracteres = Array.from(texte);
  const taille = Math.max(1, Math.ceil(caracteres.length / nombre));
  const sortie: string[] = [];
  for (let i = 0; i < caracteres.length; i += taille) sortie.push(caracteres.slice(i, i + taille).join(''));
  return sortie;
}

function texteDuMessage(u: SDKUserMessage): string {
  const contenu = u.message.content;
  if (typeof contenu === 'string') return contenu;
  return contenu.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class RequeteFactice implements RequeteSdk {
  private readonly sortie = new FileAsynchrone<SDKMessage>();
  private readonly session: string;
  private interrompue = false;
  private fermee = false;
  private echec: unknown = null;

  constructor(prompt: AsyncIterable<SDKUserMessage>, options: Options) {
    this.session = options.resume ?? options.sessionId ?? randomUUID();
    this.sortie.push(initialisation(this.session, options));
    void this.repondre(prompt);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    for await (const m of this.sortie) yield m;
    if (this.echec) throw this.echec;
  }

  private async repondre(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    try {
      for await (const message of prompt) {
        if (this.fermee) return;
        await this.tour(texteDuMessage(message));
      }
    } catch (erreur) {
      this.echec = erreur;
    } finally {
      this.sortie.clore();
    }
  }

  private async tour(texte: string): Promise<void> {
    this.interrompue = false;
    const debut = Date.now();
    if (texte.includes(MOT_OUTIL)) this.appelerOutil();
    const reponse = `Réponse factice à : « ${texte} »`;
    const complet = await this.diffuser(`msg_factice_${randomUUID()}`, reponse);
    this.sortie.push(resultatTour(this.session, Date.now() - debut, complet ? reponse : null));
  }

  private appelerOutil(): void {
    const outilId = `toolu_factice_${randomUUID()}`;
    const entree = { command: COMMANDE_OUTIL, description: 'Commande factice' };
    const appel = [{ type: 'tool_use', id: outilId, name: 'Bash', input: entree }];
    this.sortie.push(messageAssistant(this.session, `msg_factice_${randomUUID()}`, appel, 'tool_use'));
    this.sortie.push(resultatOutil(this.session, outilId));
  }

  // Renvoie false si la réponse a été coupée (interruption ou fermeture) : pas de message final.
  private async diffuser(id: string, reponse: string): Promise<boolean> {
    const entete = { id, type: 'message', role: 'assistant', model: MODELE_FACTICE, content: [], stop_reason: null };
    const ouverture = { type: 'message_start', message: { ...entete, usage: USAGE_FACTICE } };
    this.sortie.push(evenementFlux(this.session, ouverture));
    const bloc = { type: 'text', text: '' };
    this.sortie.push(evenementFlux(this.session, { type: 'content_block_start', index: 0, content_block: bloc }));
    for (const morceau of morceaux(reponse, MORCEAUX_REPONSE)) {
      await pause(PAUSE_MORCEAU_MS);
      if (this.interrompue || this.fermee) return false;
      const delta = { type: 'text_delta', text: morceau };
      this.sortie.push(evenementFlux(this.session, { type: 'content_block_delta', index: 0, delta }));
    }
    this.sortie.push(evenementFlux(this.session, { type: 'content_block_stop', index: 0 }));
    this.sortie.push(evenementFlux(this.session, { type: 'message_stop' }));
    this.sortie.push(messageAssistant(this.session, id, [{ type: 'text', text: reponse }], 'end_turn'));
    return true;
  }

  async interrupt(): Promise<unknown> {
    this.interrompue = true;
    return undefined;
  }

  async stopTask(): Promise<void> {}

  close(): void {
    this.fermee = true;
    this.sortie.clore();
  }

  async setPermissionMode(): Promise<void> {}

  async setModel(): Promise<void> {}

  async applyFlagSettings(): Promise<void> {}

  async getSettings(): Promise<unknown> {
    return { applied: { ultracode: false, ultracodeRequested: false, ultracodeAvailable: false } };
  }

  async toggleMcpServer(): Promise<void> {}

  async mcpServerStatus(): Promise<readonly { readonly name: string; readonly status: string }[]> {
    return [];
  }

  async initializationResult(): Promise<{
    readonly output_style: string;
    readonly available_output_styles: readonly string[];
    readonly models: readonly { readonly value: string; readonly displayName: string }[];
  }> {
    return {
      output_style: 'default',
      available_output_styles: ['default'],
      models: [{ value: MODELE_FACTICE, displayName: 'Factice' }],
    };
  }

  async reloadOutputStyles(): Promise<unknown> {
    return undefined;
  }

  // Valeurs neutres : forme partielle, seuls les champs lus par contexte-sdk.ts et usage-compte.ts existent.
  async getContextUsage(): Promise<SDKControlGetContextUsageResponse> {
    return CONTEXTE_NEUTRE as unknown as SDKControlGetContextUsageResponse;
  }

  async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(): Promise<SDKControlGetUsageResponse> {
    return USAGE_NEUTRE as unknown as SDKControlGetUsageResponse;
  }
}

const fabriqueFactice: FabriqueRequete = (p) => new RequeteFactice(p.prompt, p.options);

// Le moteur factice n'existe que si le poste a été démarré avec LANTERNE_SDK_FACTICE=1 (lu une fois, dans la config).
// Sinon l'environnement ne porte aucune fabrique : la session garde le vrai SDK.
export function requeteFactice(factice: boolean, journal: Logger): Pick<EnvironnementSdk, 'requete'> {
  if (!factice) return {};
  journal.warn('moteur de session FACTICE : aucune requête à Claude');
  return { requete: fabriqueFactice };
}
