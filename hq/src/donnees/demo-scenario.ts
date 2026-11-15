// Responsabilité : le scénario de la démo du monde — deux machines, quatre projets, cinq sessions qui tournent en
// boucle (un cycle = CYCLE_DEMO_MS). Données seules : l'horloge et la diffusion vivent ailleurs.
import type { Dialogue, Evenement, Notification, Projet, StatutSession } from './contrat';

export const CYCLE_DEMO_MS = 240_000;

export interface PasDemo {
  readonly a: number; // ms depuis le début du cycle de la session
  readonly statut: StatutSession;
  readonly dialogue: Dialogue | null;
  readonly inactive: boolean; // inactiveDepuis posé à cet instant
  readonly evt?: Evenement;
  readonly notif?: { readonly niveau: Notification['niveau']; readonly titre: string; readonly texte: string };
}

export interface SessionScenario {
  readonly id: string;
  readonly machine: string;
  readonly projet: Projet;
  readonly titre: string;
  readonly modele: string;
  readonly decalageMs: number;
  readonly pas: readonly [PasDemo, ...PasDemo[]]; // triés par `a`, le premier commence le cycle
}

export const MACHINES_DEMO: readonly { readonly id: string; readonly description: string }[] = [
  { id: 'poste-a', description: 'Poste A (démo, fixe)' },
  { id: 'poste-b', description: 'Poste B (démo, portable)' },
];

const secondes = (n: number): number => n * 1000;

function pas(n: number, statut: StatutSession, extra: Partial<Omit<PasDemo, 'a' | 'statut'>> = {}): PasDemo {
  return { a: secondes(n), statut, dialogue: null, inactive: false, ...extra };
}

function projet(machine: string, nom: string): Projet {
  return { machine, chemin: `/demo/${nom}`, nom };
}

// Détail = entrée JSON de l'outil, comme le poste la transmet (voir poste/session/traduction.ts).
const LECTURE: Evenement = {
  type: 'outil',
  id: 'o-lecture',
  nom: 'Read',
  resume: 'src/donnees/monde-etat.ts',
  detail: '{"file_path": "src/donnees/monde-etat.ts"}',
};
const GREP: Evenement = {
  type: 'outil',
  id: 'o-grep',
  nom: 'Grep',
  resume: 'resume',
  detail: '{"pattern": "resume"}',
};
const TEST: Evenement = {
  type: 'outil',
  id: 'o-test',
  nom: 'Bash',
  resume: 'bun test src/donnees',
  detail: '{"command": "bun test src/donnees"}',
};

export const QUESTION_FORMAT: Dialogue = {
  id: 'q-format',
  titre: 'Format des résumés ?',
  options: [
    { libelle: 'Court', description: 'Trois lignes par session' },
    { libelle: 'Détaillé', description: 'Un paragraphe par session' },
  ],
  multiple: false,
  saisie: null,
  coches: [],
};

export const SCENARIO_SESSIONS: readonly SessionScenario[] = [
  {
    id: 'demo-1',
    machine: 'poste-a',
    projet: projet('poste-a', 'agent-hq'),
    titre: 'Moteur SDK du poste',
    modele: 'opus',
    decalageMs: 0,
    pas: [
      pas(0, 'travail', { evt: LECTURE }),
      pas(40, 'travail', { evt: { type: 'texte', texte: 'Je branche le magasin sur la source.' } }),
      pas(120, 'attente', { evt: { type: 'tour_fini', dureeMs: 80_000, contexte: 84_000 } }),
      pas(170, 'attente', { inactive: true }),
    ],
  },
  {
    id: 'demo-2',
    machine: 'poste-b',
    projet: projet('poste-b', 'stockiop'),
    titre: 'Migration des stocks',
    modele: 'sonnet',
    decalageMs: secondes(30),
    pas: [
      pas(0, 'travail', { evt: TEST }),
      pas(60, 'attente', { evt: { type: 'tour_fini', dureeMs: 60_000, contexte: 61_000 } }),
    ],
  },
  {
    id: 'demo-3',
    machine: 'poste-a',
    projet: projet('poste-a', 'echohub-v2'),
    titre: 'Résumeur nocturne',
    modele: 'opus',
    decalageMs: secondes(60),
    pas: [
      pas(0, 'travail', { evt: GREP }),
      pas(50, 'question', {
        dialogue: QUESTION_FORMAT,
        evt: { type: 'question', question: 'Format des résumés ?' },
        notif: { niveau: 'important', titre: 'Question de echohub-v2', texte: 'Format des résumés ?' },
      }),
      pas(110, 'travail', { evt: { type: 'texte', texte: 'Format détaillé retenu.' } }),
      pas(170, 'attente', { evt: { type: 'tour_fini', dureeMs: 110_000, contexte: 90_000 } }),
    ],
  },
  {
    id: 'demo-4',
    machine: 'poste-b',
    projet: projet('poste-b', 'roblox-elevage'),
    titre: 'Enclos et nourrissage',
    modele: 'sonnet',
    decalageMs: 0,
    pas: [
      pas(0, 'attente', { inactive: true }),
      pas(200, 'travail', { evt: { type: 'texte', texte: 'Reprise : nourrissage à vérifier.' } }),
    ],
  },
  {
    id: 'demo-5',
    machine: 'poste-b',
    projet: projet('poste-b', 'echohub-v2'),
    titre: 'Relecture de la mise en page',
    modele: 'opus',
    decalageMs: secondes(90),
    pas: [
      pas(0, 'fermee'),
      pas(150, 'erreur', { evt: { type: 'erreur', message: 'session tmux introuvable' } }),
    ],
  },
];
