// Responsabilité : le faux SDK des tests de session-sdk — une requête rejouée par un scénario, jamais le vrai modèle.
import type {
  Options,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import pino from 'pino';
import type { Evenement, ResumeSession, StatutSession } from '../../commun/session.ts';
import { FileAsynchrone } from './file-messages-sdk.ts';
import type { SessionPersistee } from './persistance.ts';
import type { SortieSession } from './session-poste.ts';
import {
  type EnvironnementSdk,
  type FabriqueRequete,
  type RequeteSdk,
  SessionSdk,
  type TraductionSdk,
} from './session-sdk.ts';
import { nouvelEtatTraduction, type SortieTraduction } from './traduction-sdk.ts';

// Faux messages du SDK : seule la forme lue par le faux traducteur compte, le vrai SDK n'est jamais appelé.
type Faux = {
  readonly type: string;
  readonly texte?: string;
  readonly erreur?: string | null;
  readonly contexte?: number;
};
const faux = (f: Faux): SDKMessage => f as unknown as SDKMessage; // forme factice, voir ci-dessus
const lireFaux = (m: SDKMessage): Faux => m as unknown as Faux; // inverse de faux

function traduireFaux(msg: SDKMessage): SortieTraduction {
  const f = lireFaux(msg);
  if (f.type === 'result') {
    const contexte = f.contexte ?? 1200;
    return {
      evenements: [{ type: 'tour_fini', dureeMs: 5, contexte }],
      finDeTour: { dureeMs: 5, contexte, erreur: f.erreur ?? null },
    };
  }
  if (f.type === 'texte') return { evenements: [{ type: 'texte', texte: f.texte ?? '' }] };
  if (f.type === 'compaction') return { evenements: [], compaction: true };
  return { evenements: [] };
}

export const CONTEXTE_FAUX = {
  model: 'claude-haiku-5-5',
  totalTokens: 30000,
  rawMaxTokens: 1000000,
  percentage: 3,
  categories: [
    { name: 'System prompt', tokens: 460, kind: 'used' },
    { name: 'MCP tools (deferred)', tokens: 120000, kind: 'deferred' },
    { name: 'Messages', tokens: 4000, kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
    { name: 'Free space', tokens: 937000, kind: 'free' },
  ],
  mcpTools: [{ name: 'mcp__claude_ai_Flix__my_library', serverName: 'claude_ai_Flix', tokens: 100, isLoaded: false }],
  memoryFiles: [{ path: '/projets/app/CLAUDE.md', type: 'Project', tokens: 800 }],
};

export const traduction: TraductionSdk = { nouvelEtat: nouvelEtatTraduction, traduire: traduireFaux };
export const journal = pino({ level: 'silent' });

type Scenario = (texte: string, requete: RequeteFausse) => Promise<Faux[]>;

export class RequeteFausse implements RequeteSdk {
  readonly sortie = new FileAsynchrone<SDKMessage>();
  interrompue = false;
  fermee = false;
  mcpAppels = 0;
  contexteAppels = 0;
  private echec: unknown = null;

  constructor(
    prompt: AsyncIterable<SDKUserMessage>,
    readonly options: Options,
    private readonly scenario: Scenario,
    private readonly mcp: string[][],
  ) {
    void this.jouer(prompt);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    for await (const m of this.sortie) yield m;
    if (this.echec) throw this.echec;
  }

  async interrupt(): Promise<unknown> {
    this.interrompue = true;
    return undefined;
  }

  async stopTask(): Promise<void> {
    return undefined;
  }

  close(): void {
    this.fermee = true;
    this.sortie.clore();
  }

  readonly reglages: string[] = [];

  async setPermissionMode(mode: string): Promise<void> {
    this.reglages.push(`mode:${mode}`);
  }

  async setModel(model?: string): Promise<void> {
    this.reglages.push(`modele:${model ?? 'défaut'}`);
  }

  async applyFlagSettings(settings: {
    readonly effortLevel?: string | null;
    readonly outputStyle?: string | null;
  }): Promise<void> {
    if (settings.outputStyle !== undefined) this.reglages.push(`style:${settings.outputStyle ?? 'défaut'}`);
    else this.reglages.push(`effort:${settings.effortLevel ?? 'défaut'}`);
  }

  readonly connecteursBascules: string[] = [];
  readonly styleInitial = { output_style: 'default', available_output_styles: ['default', 'Explanatory', 'Learning'] };
  rechargements = 0;

  async toggleMcpServer(nom: string, actif: boolean): Promise<void> {
    this.connecteursBascules.push(`${nom}:${actif ? 'actif' : 'inactif'}`);
  }

  modelesInitiaux: readonly ModeleFaux[] = [
    { value: 'claude-mythos-5-2', displayName: 'Mythos 5.2' },
    { value: 'claude-haiku-5-5', displayName: 'Haiku 5.5' },
  ];

  async initializationResult(): Promise<{
    readonly output_style: string;
    readonly available_output_styles: readonly string[];
    readonly models: readonly ModeleFaux[];
  }> {
    return { ...this.styleInitial, models: this.modelesInitiaux };
  }

  async reloadOutputStyles(): Promise<unknown> {
    this.rechargements += 1;
    return undefined;
  }

  async mcpServerStatus(): Promise<{ readonly name: string; readonly status: string }[]> {
    this.mcpAppels += 1;
    return (this.mcp.shift() ?? ['connected']).map((status, rang) => ({ name: `connecteur-${rang + 1}`, status }));
  }

  // Forme partielle : seuls les champs que contexte-sdk.ts lit existent.
  async getContextUsage(): Promise<SDKControlGetContextUsageResponse> {
    this.contexteAppels += 1;
    return CONTEXTE_FAUX as unknown as SDKControlGetContextUsageResponse; // forme partielle, voir ci-dessus
  }

  private async jouer(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const u of prompt) {
      const texte = typeof u.message.content === 'string' ? u.message.content : '';
      try {
        for (const m of await this.scenario(texte, this)) this.sortie.push(faux(m));
      } catch (erreur) {
        this.echec = erreur;
        this.sortie.clore();
      }
    }
  }
}

interface Reglages {
  readonly resume?: Partial<ResumeSession>; // champs de la fiche posés avant le démarrage (style, annexe, sandbox…)
  readonly objectif?: string;
  readonly env?: Record<string, string | undefined>;
  readonly mcp?: string[][];
  readonly configDir?: string | null;
  readonly reprise?: Reprise;
  readonly modeles?: ModeleFaux[]; // liste de modèles renvoyée par le SDK (défaut : deux modèles)
}

interface ModeleFaux {
  readonly value: string;
  readonly resolvedModel?: string;
  readonly displayName: string;
}

// L'état d'une session persistée avant l'arrêt du poste.
interface Reprise {
  readonly statut?: StatutSession;
  readonly claudeSessionId?: string | null;
  readonly aReprendre?: boolean;
}

export function persistee(
  configDir: string | null,
  objectif: string | null = null,
  reprise: Reprise = {},
): SessionPersistee {
  const resume: ResumeSession = {
    id: 'quart-1',
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/projets/app', nom: 'app' },
    cwd: '/projets/app',
    titre: 'Test',
    objectif,
    modele: 'claude-haiku-5-5',
    compte: 'principal',
    autonomie: false,
    statut: reprise.statut ?? 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: reprise.claudeSessionId === undefined ? 'claude-abc' : reprise.claudeSessionId,
    moteur: 'sdk',
    tmux: null,
    attachee: false,
    pilotee: true,
    creeLe: '2026-11-15T00:00:00.000Z',
    majLe: '2026-11-15T00:00:00.000Z',
  };
  return {
    resume,
    consignes: 'Consignes ccremote',
    configDir,
    transcript: null,
    position: 0,
    aReprendre: reprise.aReprendre ?? false,
  };
}

export function nouvelleSession(scenario: Scenario, reglages: Reglages = {}) {
  const requetes: RequeteFausse[] = [];
  const evenements: Evenement[] = [];
  const fabrique: FabriqueRequete = (p) => {
    const requete = new RequeteFausse(p.prompt, p.options, scenario, reglages.mcp ?? []);
    if (reglages.modeles) requete.modelesInitiaux = reglages.modeles;
    requetes.push(requete);
    return requete;
  };
  const sortie: SortieSession = {
    evenement: (_id, evt) => void evenements.push(evt),
    resume: () => undefined,
  };
  const env: EnvironnementSdk = {
    journal,
    sortie,
    executable: null,
    requete: fabrique,
    traduction,
    env: reglages.env ?? { HOME: '/home/test' },
    socket: '/run/poste.sock',
    delaiMcpMs: 200,
    periodeMcpMs: 1,
  };
  const base = persistee(reglages.configDir ?? null, reglages.objectif ?? null, reglages.reprise);
  const persistance = reglages.resume ? { ...base, resume: { ...base.resume, ...reglages.resume } } : base;
  return { session: new SessionSdk(persistance, env), requetes, evenements };
}

export async function attendre(condition: () => boolean, delai = 2000): Promise<void> {
  const fin = Date.now() + delai;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 2));
  }
}
