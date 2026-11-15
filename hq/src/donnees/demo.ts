// Responsabilité : la source de démonstration du monde — mêmes contrats que le relais, sur une horloge injectée.
// Le scénario tourne seul ; une session que Chris touche sort du scénario et réagit à ses actions (demo-vivante).
// Sans réseau : l'app vit même sans relais (VITE_SOURCE=demo, défaut).
import type { EtatRelais, MessageClient, ResumeSession } from './contrat';
import { QUESTION_FORMAT, SCENARIO_SESSIONS } from './demo-scenario';
import { etatDemo, historiqueDemo, messagesEntre, sessionALInstant } from './demo-simulation';
import { creerFichiersDemo } from './fichiers-demo';
import { DemoVivante, type PlanificateurUnique, sessionDuMessage } from './demo-vivante';
import type { ApiMonde, EcouteurSource, SourceMonde } from './source-monde';
import { fabriqueTerminalDemo } from './terminal-demo';

export type Planificateur = (fn: () => void, ms: number) => () => void;

export interface OptionsDemo {
  readonly horloge?: () => number;
  readonly planifier?: Planificateur;
  readonly planifierUnique?: PlanificateurUnique;
  readonly intervalleMs?: number;
}

interface Canal {
  ecouteur: EcouteurSource | null;
}

interface Diffusion {
  demarrer(ecouteur: EcouteurSource): void;
  arreter(): void;
}

const INTERVALLE_PAR_DEFAUT_MS = 1_000;

export function creerSourceDemo(options: OptionsDemo = {}): SourceMonde {
  const horloge = options.horloge ?? Date.now;
  const t0 = horloge();
  const canal: Canal = { ecouteur: null };
  const vivante = new DemoVivante({
    horloge,
    planifier: options.planifierUnique ?? planifierDelai,
    base: (sessionId) => baseDeSession(t0, horloge(), sessionId),
    emettre: (message) => canal.ecouteur?.surMessage(message),
  });
  vivante.prendre('demo-3', { statut: 'question', dialogue: QUESTION_FORMAT });
  const diffusion = creerDiffusion({
    t0,
    horloge,
    vivante,
    canal,
    planifier: options.planifier ?? planifierIntervalle,
    intervalleMs: options.intervalleMs ?? INTERVALLE_PAR_DEFAUT_MS,
  });
  return {
    nom: 'demo',
    api: apiDemo(vivante),
    fichiers: creerFichiersDemo(),
    ouvrirTerminal: fabriqueTerminalDemo,
    etatInitial: async () => etatAvecPrises(t0, horloge(), vivante),
    evenements: async (sessionId) => historiqueDemo(t0, horloge(), sessionId),
    demarrer: (ecouteur: EcouteurSource) => diffusion.demarrer(ecouteur),
    arreter: () => {
      diffusion.arreter();
      vivante.arreter();
      canal.ecouteur = null;
    },
  };
}

interface OptionsDiffusion {
  readonly t0: number;
  readonly horloge: () => number;
  readonly vivante: DemoVivante;
  readonly canal: Canal;
  readonly planifier: Planificateur;
  readonly intervalleMs: number;
}

// Diffuse les messages du scénario, sauf ceux des sessions que Chris a prises en main.
function creerDiffusion(options: OptionsDiffusion): Diffusion {
  const { t0, horloge, vivante, canal, planifier, intervalleMs } = options;
  let dernier = t0;
  let arreterTick: (() => void) | null = null;
  const arreter = (): void => {
    arreterTick?.();
    arreterTick = null;
  };
  const demarrer = (ecouteur: EcouteurSource): void => {
    arreter();
    canal.ecouteur = ecouteur;
    dernier = horloge();
    ecouteur.surLien('ouvert');
    arreterTick = planifier(() => {
      const maintenant = horloge();
      for (const message of messagesEntre(t0, dernier, maintenant)) {
        if (!estPrise(vivante, message)) ecouteur.surMessage(message);
      }
      dernier = maintenant;
    }, intervalleMs);
  };
  return { demarrer, arreter };
}

function estPrise(vivante: DemoVivante, message: MessageClient): boolean {
  const sessionId = sessionDuMessage(message);
  return sessionId !== null && vivante.estPrise(sessionId);
}

function baseDeSession(t0: number, maintenant: number, sessionId: string): ResumeSession | undefined {
  const definition = SCENARIO_SESSIONS.find((s) => s.id === sessionId);
  return definition ? sessionALInstant(definition, t0, maintenant) : undefined;
}

function etatAvecPrises(t0: number, maintenant: number, vivante: DemoVivante): EtatRelais {
  const etat = etatDemo(t0, maintenant);
  return { ...etat, sessions: etat.sessions.map((s) => vivante.priseDe(s.id) ?? s) };
}

function apiDemo(vivante: DemoVivante): ApiMonde {
  return {
    envoyerMessage: async (sessionId, texte) => vivante.envoyer(sessionId, texte),
    repondre: async (sessionId, reponse) => vivante.repondre(sessionId, reponse),
    agir: async (sessionId, action) => vivante.agir(sessionId, action),
  };
}

function planifierIntervalle(fn: () => void, ms: number): () => void {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}

function planifierDelai(fn: () => void, ms: number): () => void {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}
