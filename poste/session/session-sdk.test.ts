import { describe, expect, test } from 'bun:test';
import type { Options, PermissionResult, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
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
import { DELAI_REVEIL_MS, TEXTE_REVEIL } from './nuit.ts';
import { CONSIGNE_COMPACTION } from './politique-compaction.ts';

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

const traduction: TraductionSdk = { nouvelEtat: nouvelEtatTraduction, traduire: traduireFaux };
const journal = pino({ level: 'silent' });
const QUESTIONS = {
  questions: [
    {
      question: 'Quelle couleur ?',
      header: 'Couleur',
      multiSelect: false,
      options: [
        { label: 'Bleu', description: 'ciel' },
        { label: 'Vert', description: 'herbe' },
      ],
    },
  ],
};

type Scenario = (texte: string, requete: RequeteFausse) => Promise<Faux[]>;

class RequeteFausse implements RequeteSdk {
  readonly sortie = new FileAsynchrone<SDKMessage>();
  interrompue = false;
  fermee = false;
  mcpAppels = 0;
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

  close(): void {
    this.fermee = true;
    this.sortie.clore();
  }

  async mcpServerStatus(): Promise<{ readonly status: string }[]> {
    this.mcpAppels += 1;
    return (this.mcp.shift() ?? ['connected']).map((status) => ({ status }));
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
  readonly objectif?: string;
  readonly env?: Record<string, string | undefined>;
  readonly mcp?: string[][];
  readonly configDir?: string | null;
}

function persistee(configDir: string | null, objectif: string | null = null): SessionPersistee {
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
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'claude-abc',
    moteur: 'sdk',
    tmux: null,
    attachee: false,
    pilotee: true,
    creeLe: '2026-11-15T00:00:00.000Z',
    majLe: '2026-11-15T00:00:00.000Z',
  };
  return { resume, consignes: 'Consignes ccremote', configDir, transcript: null, position: 0 };
}

function nouvelleSession(scenario: Scenario, reglages: Reglages = {}) {
  const requetes: RequeteFausse[] = [];
  const evenements: Evenement[] = [];
  const fabrique: FabriqueRequete = (p) => {
    const requete = new RequeteFausse(p.prompt, p.options, scenario, reglages.mcp ?? []);
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
  const persistance = persistee(reglages.configDir ?? null, reglages.objectif ?? null);
  return { session: new SessionSdk(persistance, env), requetes, evenements };
}

async function attendre(condition: () => boolean, delai = 2000): Promise<void> {
  const fin = Date.now() + delai;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 2));
  }
}

function demanderPermission(
  requete: RequeteFausse,
  nom: string,
  entree: Record<string, unknown>,
): Promise<PermissionResult | null> {
  const autoriser = requete.options.canUseTool;
  if (!autoriser) throw new Error('canUseTool absent des options');
  return autoriser(nom, entree, { signal: new AbortController().signal, toolUseID: 't-1', requestId: 'r-1' });
}

describe('SessionSdk', () => {
  test('deux tours dans la même session : une requête, fin de tour à chaque result', async () => {
    const { session, requetes, evenements } = nouvelleSession(async (texte) => [
      { type: 'texte', texte: `réponse à ${texte}` },
      { type: 'result' },
    ]);
    expect(await session.lancer('un')).toBeNull();
    await attendre(() => evenements.filter((e) => e.type === 'tour_fini').length === 1);
    expect(session.resume.statut).toBe('attente');
    expect(await session.envoyer('deux')).toBeNull();
    await attendre(() => evenements.filter((e) => e.type === 'tour_fini').length === 2);
    expect(requetes).toHaveLength(1);
    expect(evenements).toContainEqual({ type: 'texte', texte: 'réponse à deux' });
    expect(session.resume.statut).toBe('attente');
    expect(session.resume.contexte.tokens).toBe(1200);
    expect(session.resume.moteur).toBe('sdk');
    expect(session.resume.tmux).toBeNull();
  });

  test('AskUserQuestion devient un dialogue, la réponse de Chris part au SDK', async () => {
    const decisions: (PermissionResult | null)[] = [];
    const { session, requetes } = nouvelleSession(async (_texte, requete) => {
      decisions.push(await demanderPermission(requete, 'AskUserQuestion', QUESTIONS));
      return [{ type: 'result' }];
    });
    await session.lancer('demande');
    await attendre(() => session.resume.statut === 'question');
    const dialogue = session.resume.dialogue;
    if (!dialogue) throw new Error('dialogue attendu');
    expect(dialogue.titre).toBe('Quelle couleur ?');
    expect(dialogue.options.map((o) => o.libelle)).toEqual(['Bleu', 'Vert', 'Autre (réponse libre)']);
    expect(await session.repondre({ id: dialogue.id, index: 1 })).toBeNull();
    await attendre(() => decisions.length === 1);
    expect(decisions[0]).toEqual({
      behavior: 'allow',
      updatedInput: { ...QUESTIONS, answers: { 'Quelle couleur ?': 'Vert' } },
    });
    expect(session.resume.dialogue).toBeNull();
    expect(requetes).toHaveLength(1);
  });

  test('une réponse à un identifiant périmé est refusée', async () => {
    const { session } = nouvelleSession(async (_texte, requete) => {
      await demanderPermission(requete, 'AskUserQuestion', QUESTIONS);
      return [];
    });
    await session.lancer('demande');
    await attendre(() => session.resume.statut === 'question');
    expect(await session.repondre({ id: 'ancien', index: 0 })).toMatch(/périmée/);
  });

  test('ExitPlanMode : refus avec un texte, transmis comme motif', async () => {
    const decisions: (PermissionResult | null)[] = [];
    const { session } = nouvelleSession(async (_texte, requete) => {
      decisions.push(await demanderPermission(requete, 'ExitPlanMode', {}));
      return [{ type: 'result' }];
    });
    await session.lancer('plan');
    await attendre(() => session.resume.statut === 'question');
    const dialogue = session.resume.dialogue;
    if (!dialogue) throw new Error('dialogue attendu');
    await session.repondre({ id: dialogue.id, index: 1, texte: 'revois l’étape 2' });
    await attendre(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ behavior: 'deny', message: 'revois l’étape 2' });
  });

  test('un outil ordinaire est autorisé sans passer par une question', async () => {
    const decisions: (PermissionResult | null)[] = [];
    const { session } = nouvelleSession(async (_texte, requete) => {
      decisions.push(await demanderPermission(requete, 'Bash', { command: 'ls' }));
      return [{ type: 'result' }];
    });
    await session.lancer('ls');
    await attendre(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    expect(session.resume.statut).not.toBe('question');
  });

  test('interrompre rejette la question en cours et interrompt le SDK', async () => {
    const decisions: (PermissionResult | null)[] = [];
    const { session, requetes } = nouvelleSession(async (_texte, requete) => {
      decisions.push(await demanderPermission(requete, 'AskUserQuestion', QUESTIONS));
      return [{ type: 'result' }];
    });
    await session.lancer('demande');
    await attendre(() => session.resume.statut === 'question');
    expect(await session.interrompre()).toBeNull();
    await attendre(() => decisions.length === 1);
    expect(decisions[0]).toEqual({ behavior: 'deny', message: 'Interrompu par Chris', interrupt: true });
    expect(requetes[0]?.interrompue).toBe(true);
  });

  test('fermer puis reprendre relance une requête en reprise de la même conversation', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente');
    expect(await session.fermer()).toBeNull();
    expect(session.resume.statut).toBe('fermee');
    expect(requetes[0]?.fermee).toBe(true);
    expect(await session.reprendre('deux')).toBeNull();
    expect(requetes).toHaveLength(2);
    expect(requetes[1]?.options.resume).toBe('claude-abc');
    expect(requetes[1]?.options.sessionId).toBeUndefined();
    await attendre(() => session.resume.statut === 'attente');
  });

  test('la requête reçoit un environnement filtré et le compte choisi', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }], {
      env: { CLAUDE_CODE_SESSION_ID: 'parent', ANTHROPIC_API_KEY: 'cle', CHEMIN: '/ok' },
      configDir: '/comptes/2',
    });
    await session.lancer('un');
    expect(requetes[0]?.options.env).toEqual({ CHEMIN: '/ok', CLAUDE_CONFIG_DIR: '/comptes/2' });
  });

  test('le premier message attend que les connecteurs MCP ne soient plus en attente', async () => {
    let appelsAuMessage = -1;
    const { session } = nouvelleSession(
      async (_texte, requete) => {
        appelsAuMessage = requete.mcpAppels;
        return [{ type: 'result' }];
      },
      { mcp: [['pending'], ['pending'], ['connected']] },
    );
    await session.lancer('un');
    await attendre(() => appelsAuMessage >= 0);
    expect(appelsAuMessage).toBe(3);
  });

  test('compacter envoie /compact au SDK', async () => {
    const textes: string[] = [];
    const { session } = nouvelleSession(async (texte) => {
      textes.push(texte);
      return [{ type: 'result' }];
    });
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente');
    expect(await session.compacter()).toBeNull();
    await attendre(() => textes.length === 2);
    expect(textes[1]).toBe(CONSIGNE_COMPACTION);
  });

  test('une erreur de la requête passe la session en erreur sans exception', async () => {
    const { session, evenements } = nouvelleSession(async () => {
      throw new Error('connexion perdue');
    });
    expect(await session.lancer('un')).toBeNull();
    await attendre(() => session.resume.statut === 'erreur');
    expect(evenements.some((e) => e.type === 'erreur')).toBe(true);
  });

  test('un démarrage refusé renvoie une erreur lisible', async () => {
    const env: EnvironnementSdk = {
      journal,
      sortie: { evenement: () => undefined, resume: () => undefined },
      executable: null,
      requete: () => {
        throw new Error('binaire absent');
      },
      traduction,
      socket: '/run/poste.sock',
    };
    const session = new SessionSdk(persistee(null), env);
    expect(await session.lancer('un')).toMatch(/démarrage impossible/);
    expect(session.resume.statut).toBe('erreur');
  });
});

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('SessionSdk — rythme, fin de tour et mode nuit', () => {
  test('les outils de rythme ajoutent leur événement au fil et répondent au modèle', async () => {
    const { session, evenements } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente');
    expect(session.rythme('etape_terminee', { resume: 'fait', suite: 'suite' })).toMatch(/Étape enregistrée/);
    expect(session.rythme('objectif_atteint', { bilan: 'ok' })).toMatch(/notifié/);
    expect(session.rythme('poser_question', { question: 'Q ?' })).toMatch(/Question transmise/);
    expect(session.rythme('inconnu', {})).toMatch(/outil inconnu/);
    expect(evenements).toContainEqual({ type: 'etape', resume: 'fait', suite: 'suite' });
    expect(evenements).toContainEqual({ type: 'objectif_atteint', bilan: 'ok' });
    expect(evenements).toContainEqual({ type: 'question', question: 'Q ?' });
    expect(session.resume.etapes).toBe(1);
  });

  test('le serveur de rythme de la session est branché en MCP ccremote sur le même socket que tmux', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    expect(requetes[0]?.options.mcpServers).toMatchObject({
      ccremote: { type: 'stdio', env: { CCREMOTE_SESSION: 'quart-1', CCREMOTE_SOCKET: '/run/poste.sock' } },
    });
  });

  test('autonomie : relance tant que l’objectif n’est pas déclaré, pause après trois tours à vide', async () => {
    const textes: string[] = [];
    const { session } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        return [{ type: 'texte', texte: 'rien' }, { type: 'result' }];
      },
      { objectif: 'Livrer X' },
    );
    session.basculerAutonomie(true);
    await session.lancer('un');
    await attendre(() => textes.length === 3 && session.resume.statut === 'attente');
    await pause(20);
    expect(textes).toHaveLength(3);
    expect(textes[1]).toMatch(/Continue vers l’objectif/);
  });

  test('objectif atteint : la session s’arrête, sans relance', async () => {
    const textes: string[] = [];
    const { session } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        session.rythme('objectif_atteint', { bilan: 'fini' });
        return [{ type: 'result' }];
      },
      { objectif: 'Livrer X' },
    );
    session.basculerAutonomie(true);
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'terminee');
    await pause(20);
    expect(textes).toHaveLength(1);
  });

  test('un message de Chris écrit pendant le tour évite la relance', async () => {
    const textes: string[] = [];
    let libere: () => void = () => undefined;
    const attente = new Promise<void>((r) => {
      libere = r;
    });
    const { session } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        if (texte === 'un') await attente;
        return [{ type: 'result' }];
      },
      { objectif: 'Livrer X' },
    );
    session.basculerAutonomie(true);
    await session.lancer('un');
    await session.envoyer('deux');
    libere();
    await attendre(() => textes.length >= 2);
    expect(textes[1]).toBe('deux');
  });

  test('une interruption par Chris ne relance pas le tour interrompu', async () => {
    const textes: string[] = [];
    let libere: () => void = () => undefined;
    const attente = new Promise<void>((r) => {
      libere = r;
    });
    const { session } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        await attente;
        return [{ type: 'result' }];
      },
      { objectif: 'Livrer X' },
    );
    session.basculerAutonomie(true);
    await session.lancer('un');
    expect(await session.interrompre()).toBeNull();
    libere();
    await attendre(() => session.resume.statut === 'attente');
    await pause(20);
    expect(textes).toHaveLength(1);
  });

  test('fin d’étape lourde : compaction avec la consigne tmux, puis la reprise est close sans relance', async () => {
    const textes: string[] = [];
    const { session, evenements } = nouvelleSession(async (texte) => {
      textes.push(texte);
      if (texte !== 'un') return [{ type: 'compaction' }, { type: 'result', contexte: 2_000 }];
      session.rythme('etape_terminee', { resume: 'r', suite: 's' });
      return [{ type: 'result', contexte: 130_000 }];
    });
    await session.lancer('un');
    await attendre(() => textes.length === 2 && session.resume.statut === 'attente');
    expect(textes[1]).toBe(CONSIGNE_COMPACTION);
    expect(evenements.some((e) => e.type === 'relance' && e.raison.startsWith('compaction'))).toBe(true);
    await pause(20);
    expect(textes).toHaveLength(2);
  });

  test('mode nuit : une session à l’arrêt depuis le délai est réveillée par le poste', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'nuit-sdk-'));
    mkdirSync(join(dossier, 'sessions'));
    process.env['QUART_NUIT_DIR'] = dossier;
    const t0 = Date.now();
    const fichier = JSON.stringify({ since: t0 / 1000, rounds: 0, open: 1 });
    writeFileSync(join(dossier, 'sessions', 'claude-abc.json'), fichier);
    const textes: string[] = [];
    const { session } = nouvelleSession(async (texte) => {
      textes.push(texte);
      return [{ type: 'result' }];
    });
    await session.lancer('un');
    await attendre(() => session.resume.statut === 'attente');
    await session.veillerNuit(Date.now() + DELAI_REVEIL_MS + 11_000);
    await attendre(() => textes.length === 2);
    expect(textes[1]).toBe(TEXTE_REVEIL);
  });

  test('vivante tant que la requête vit ; une session fermée ne l’est plus', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }]);
    expect(session.vivante).toBe(false);
    await session.lancer('un');
    expect(session.vivante).toBe(true);
    await session.fermer();
    expect(session.vivante).toBe(false);
  });
});
