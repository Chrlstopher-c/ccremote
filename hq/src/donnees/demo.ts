// Responsabilité : la source de démonstration du monde — mêmes contrats que le relais, sur une horloge injectée.
// Sans réseau : l'app vit même sans relais (VITE_SOURCE=demo, défaut).
import { etatDemo, historiqueDemo, messagesEntre } from './demo-simulation';
import { journaliser } from './journal';
import type { ApiMonde, EcouteurSource, SourceMonde } from './source-monde';

export type Planificateur = (fn: () => void, ms: number) => () => void;

export interface OptionsDemo {
  readonly horloge?: () => number;
  readonly planifier?: Planificateur;
  readonly intervalleMs?: number;
}

const INTERVALLE_PAR_DEFAUT_MS = 1_000;

export function creerSourceDemo(options: OptionsDemo = {}): SourceMonde {
  const horloge = options.horloge ?? Date.now;
  const planifier = options.planifier ?? planifierIntervalle;
  const intervalle = options.intervalleMs ?? INTERVALLE_PAR_DEFAUT_MS;
  const t0 = horloge();
  let dernier = t0;
  let arreterDiffusion: (() => void) | null = null;

  const arreter = (): void => {
    arreterDiffusion?.();
    arreterDiffusion = null;
  };

  return {
    nom: 'demo',
    api: API_DEMO,
    etatInitial: async () => etatDemo(t0, horloge()),
    evenements: async (sessionId) => historiqueDemo(t0, horloge(), sessionId),
    demarrer: (ecouteur: EcouteurSource) => {
      arreter();
      dernier = horloge();
      ecouteur.surLien('ouvert');
      arreterDiffusion = planifier(() => {
        const maintenant = horloge();
        for (const message of messagesEntre(t0, dernier, maintenant)) ecouteur.surMessage(message);
        dernier = maintenant;
      }, intervalle);
    },
    arreter,
  };
}

function planifierIntervalle(fn: () => void, ms: number): () => void {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}

const API_DEMO: ApiMonde = {
  envoyerMessage: async (sessionId, texte) =>
    journaliser('info', 'démo : message non transmis', { sessionId, longueur: texte.length }),
  repondre: async (sessionId) => journaliser('info', 'démo : réponse non transmise', { sessionId }),
  agir: async (sessionId, action) => journaliser('info', 'démo : action sans effet', { sessionId, action }),
};
