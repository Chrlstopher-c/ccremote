// Responsabilité : ouvrir une nouvelle session (embaucher un agent) — validation de la demande, appel de la route
// POST /api/sessions du relais, ou, en démo, une session simulée ajoutée au magasin qui démarre puis se met au travail
// (la source démo n'expose aucun moyen d'ouvrir une session : on écrit directement dans le magasin du monde).
import type { ConfigMonde } from './config';
import type { EvenementDate, MessageClient, Projet, ResumeSession } from './contrat';
import { journaliser } from './journal';
import { erreurDeReponse, type Recuperer } from './transport-http';

export interface ModeleAgent {
  readonly id: string;
  readonly libelle: string;
}

export const MODELES: readonly ModeleAgent[] = [
  { id: 'claude-opus-5-5', libelle: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', libelle: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', libelle: 'Haiku 5.5' },
];
export const MODELE_PAR_DEFAUT = 'claude-opus-5-5';
export const TITRE_MAX = 120;

// Miroir réduit de DemandeOuverture (commun/api-clients.ts).
export interface DemandeOuverture {
  readonly machine: string;
  readonly projet: Projet;
  readonly message: string;
  readonly titre?: string;
  readonly modele?: string;
  readonly autonomie?: boolean; // vrai : l'agent est relancé jusqu'à son objectif ; faux : il attend Chris à chaque tour
}

export type ResultatOuverture =
  | { readonly ok: true; readonly sessionId: string | null }
  | { readonly ok: false; readonly erreur: string };

export interface ServiceOuverture {
  ouvrir(demande: DemandeOuverture): Promise<ResultatOuverture>;
}

/** Ce que la démo touche du magasin : y pousser une session et ses événements. */
export interface CibleDemo {
  appliquer(message: MessageClient): void;
}

export type Minuteur = (fn: () => void, ms: number) => void;

export function validerOuverture(d: DemandeOuverture): string | null {
  if (!d.machine) return 'choisis une machine';
  if (!d.projet.chemin) return 'choisis un projet';
  if (d.projet.machine !== d.machine) return 'ce projet n\'est pas sur cette machine';
  if (!d.message.trim()) return 'le premier message est obligatoire';
  if ((d.titre ?? '').length > TITRE_MAX) return `titre trop long (${TITRE_MAX} caractères max)`;
  return null;
}

function corpsOuverture(d: DemandeOuverture): Record<string, unknown> {
  const titre = d.titre?.trim();
  return {
    machine: d.machine,
    projet: d.projet,
    message: d.message.trim(),
    ...(titre ? { titre } : {}),
    ...(d.modele ? { modele: d.modele } : {}),
    ...(d.autonomie === undefined ? {} : { autonomie: d.autonomie }),
  };
}

function idDeReponse(donnees: unknown): string | null {
  if (typeof donnees !== 'object' || donnees === null || !('id' in donnees)) return null;
  return typeof donnees.id === 'string' ? donnees.id : null;
}

async function lireJson(reponse: Response): Promise<unknown> {
  try {
    return await reponse.json();
  } catch (erreur) {
    journaliser('warn', 'réponse d\'ouverture illisible', { erreur: String(erreur) });
    return null;
  }
}

export function creerOuvertureRelais(o: { base: string; jeton: string; recuperer?: Recuperer }): ServiceOuverture {
  const racine = o.base.replace(/\/+$/, '');
  const recuperer = o.recuperer ?? ((url: string, init: RequestInit) => fetch(url, init));
  return {
    async ouvrir(d) {
      const invalide = validerOuverture(d);
      if (invalide) return { ok: false, erreur: invalide };
      try {
        const reponse = await recuperer(`${racine}/api/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${o.jeton}`, 'content-type': 'application/json' },
          body: JSON.stringify(corpsOuverture(d)),
        });
        if (!reponse.ok) throw await erreurDeReponse(reponse);
        return { ok: true, sessionId: idDeReponse(await lireJson(reponse)) };
      } catch (erreur) {
        const message = erreur instanceof Error ? erreur.message : String(erreur);
        journaliser('warn', 'ouverture de session refusée', { machine: d.machine, erreur: message });
        return { ok: false, erreur: message || 'relais injoignable' };
      }
    },
  };
}

const DEMARRAGE_DEMO_MS = 1_500;

function sessionDemo(id: string, d: DemandeOuverture, ts: string): ResumeSession {
  const message = d.message.trim();
  return {
    id, machine: d.machine, projet: d.projet, cwd: d.projet.chemin,
    titre: d.titre?.trim() || message.split('\n')[0]?.slice(0, 60) || 'Nouvelle session',
    objectif: null, modele: d.modele ?? MODELE_PAR_DEFAUT, compte: 'demo', autonomie: d.autonomie ?? true,
    statut: 'demarrage', contexte: { tokens: 0, max: 200_000 }, etapes: 0, compactions: 0,
    claudeSessionId: null, moteur: 'sdk', tmux: null, attachee: false, pilotee: true,
    dialogue: null, creeLe: ts, majLe: ts, inactiveDepuis: null, archivee: false,
  };
}

function evenementDemo(sessionId: string, seq: number, ts: string, texte: string, chris: boolean): MessageClient {
  const evenement: EvenementDate = {
    seq, sessionId, ts, evt: chris ? { type: 'message', texte } : { type: 'texte', texte },
  };
  return { type: 'evenement', evenement };
}

/** Démo : la session apparaît en « démarrage » avec le message de Chris, puis passe au travail et répond. */
export function creerOuvertureDemo(
  cible: CibleDemo,
  o: { horloge?: () => number; minuteur?: Minuteur } = {},
): ServiceOuverture {
  const horloge = o.horloge ?? Date.now;
  const minuteur = o.minuteur ?? ((fn, ms) => void setTimeout(fn, ms));
  let compteur = 0;
  return {
    async ouvrir(d) {
      const invalide = validerOuverture(d);
      if (invalide) return { ok: false, erreur: invalide };
      compteur += 1;
      const id = `demo-nouvelle-${compteur}`;
      const ts = new Date(horloge()).toISOString();
      const session = sessionDemo(id, d, ts);
      cible.appliquer({ type: 'session', session });
      cible.appliquer(evenementDemo(id, 1, ts, d.message.trim(), true));
      minuteur(() => {
        const plusTard = new Date(horloge()).toISOString();
        cible.appliquer({ type: 'session', session: { ...session, statut: 'travail', majLe: plusTard } });
        cible.appliquer(evenementDemo(id, 2, plusTard, 'Bien reçu, je regarde le projet et je m\'y mets.', false));
      }, DEMARRAGE_DEMO_MS);
      journaliser('info', 'démo : session simulée ouverte', { sessionId: id, machine: d.machine });
      return { ok: true, sessionId: id };
    },
  };
}

/** Le service adapté à la configuration : relais réel, ou démo branchée sur le magasin. */
export function creerOuverture(config: ConfigMonde, cible: CibleDemo): ServiceOuverture {
  if (config.source === 'relais') return creerOuvertureRelais({ base: config.base, jeton: config.jeton });
  return creerOuvertureDemo(cible);
}
