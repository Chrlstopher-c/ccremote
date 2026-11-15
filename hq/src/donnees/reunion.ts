// Responsabilité : la salle de réunion côté HQ — lister, ouvrir, envoyer une demande de Chris. Miroir typé de
// commun/reunion.ts (hq n'importe rien d'autre que lui-même). Deux sources : le relais réel (HTTP, jeton porteur)
// et une démo qui simule deux sessions. Les erreurs remontent en ErreurRelais, comme le reste du dossier.
import { journaliser } from './journal';
import { ErreurRelais, type Recuperer } from './transport-http';

export const AUTEUR_CHRIS = 'chris';

export interface MessageReunion {
  readonly id: string;
  readonly auteur: string; // AUTEUR_CHRIS ou sessionId
  readonly texte: string;
  readonly ts: string;
  readonly destinataires: readonly string[];
}

export interface Reunion {
  readonly id: string;
  readonly sujet: string;
  readonly creeLe: string;
  readonly participants: readonly string[];
  readonly messages: readonly MessageReunion[];
}

export interface DemandeReunion {
  readonly texte: string;
  readonly destinataires: readonly string[] | 'auto';
  readonly reunionId?: string;
}

export interface EnvoiReunion {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly erreur?: string;
}

export interface ReponseReunion {
  readonly reunion: Reunion;
  readonly envois: readonly EnvoiReunion[];
}

export interface ApiReunions {
  lister(): Promise<readonly Reunion[]>;
  ouvrir(id: string): Promise<Reunion>;
  envoyer(demande: DemandeReunion): Promise<ReponseReunion>;
}

export class ClientReunions implements ApiReunions {
  private readonly racine: string;

  constructor(
    base: string,
    private readonly jeton: string,
    private readonly recuperer: Recuperer,
  ) {
    this.racine = base.replace(/\/+$/, '');
  }

  lister(): Promise<readonly Reunion[]> {
    return this.appeler<readonly Reunion[]>('GET', '/api/reunions');
  }

  ouvrir(id: string): Promise<Reunion> {
    return this.appeler<Reunion>('GET', `/api/reunions/${encodeURIComponent(id)}`);
  }

  envoyer(demande: DemandeReunion): Promise<ReponseReunion> {
    return this.appeler<ReponseReunion>('POST', '/api/reunions', demande);
  }

  private async appeler<T>(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<T> {
    const init: RequestInit = {
      method: methode,
      headers: {
        authorization: `Bearer ${this.jeton}`,
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    };
    const reponse = await this.envoyerRequete(chemin, init);
    const donnees = analyser(await reponse.text(), reponse.status);
    if (!reponse.ok) throw new ErreurRelais(reponse.status, messageDErreur(donnees, reponse.status));
    return donnees as T; // forme garantie par le contrat du relais (commun/reunion.ts), miroir dans ce fichier
  }

  private async envoyerRequete(chemin: string, init: RequestInit): Promise<Response> {
    try {
      return await this.recuperer(`${this.racine}${chemin}`, init);
    } catch (erreur) {
      journaliser('warn', 'salle de réunion injoignable', { chemin, erreur: String(erreur) });
      throw new ErreurRelais(0, 'relais injoignable');
    }
  }
}

interface AgentDemo {
  readonly id: string;
  readonly nom: string;
}

const AGENTS_DEMO: readonly AgentDemo[] = [
  { id: 'demo-atlas', nom: 'Atlas' },
  { id: 'demo-boreal', nom: 'Boréal' },
];

const SUJET_MAX = 60;
const EXTRAIT_MAX = 40;

export function creerReunionsDemo(maintenant: () => Date = () => new Date()): ApiReunions {
  return new ReunionsDemo(maintenant);
}

// Démo : chaque agent répond une fois, de façon déterministe ; aucun appel au relais.
class ReunionsDemo implements ApiReunions {
  private readonly reunions = new Map<string, Reunion>();
  private compteur = 0;

  constructor(private readonly maintenant: () => Date) {}

  async lister(): Promise<readonly Reunion[]> {
    return [...this.reunions.values()];
  }

  async ouvrir(id: string): Promise<Reunion> {
    return this.trouver(id);
  }

  async envoyer(demande: DemandeReunion): Promise<ReponseReunion> {
    const existante = demande.reunionId === undefined ? null : this.trouver(demande.reunionId);
    const cibles = demande.destinataires === 'auto' ? AGENTS_DEMO.map((a) => a.id) : [...demande.destinataires];
    const depart = existante ?? this.nouvelle(demande.texte);
    let reunion = this.ajouter(depart, { auteur: AUTEUR_CHRIS, texte: demande.texte, destinataires: cibles });
    reunion = { ...reunion, participants: [...new Set([...reunion.participants, ...cibles])] };
    for (const agent of AGENTS_DEMO.filter((a) => cibles.includes(a.id))) {
      const texte = `${agent.nom} : bien reçu, « ${extrait(demande.texte)} ».`;
      reunion = this.ajouter(reunion, { auteur: agent.id, texte, destinataires: [] });
    }
    this.reunions.set(reunion.id, reunion);
    const envois = cibles.map((sessionId) => envoiDemo(sessionId));
    return { reunion, envois };
  }

  private trouver(id: string): Reunion {
    const reunion = this.reunions.get(id);
    if (!reunion) throw new ErreurRelais(404, 'réunion inconnue');
    return reunion;
  }

  private nouvelle(texte: string): Reunion {
    this.compteur += 1;
    return {
      id: `demo-reunion-${this.compteur}`,
      sujet: titre(texte),
      creeLe: this.maintenant().toISOString(),
      participants: [],
      messages: [],
    };
  }

  private ajouter(
    reunion: Reunion,
    message: { readonly auteur: string; readonly texte: string; readonly destinataires: readonly string[] },
  ): Reunion {
    this.compteur += 1;
    const complet: MessageReunion = {
      id: `demo-message-${this.compteur}`,
      ts: this.maintenant().toISOString(),
      ...message,
    };
    return { ...reunion, messages: [...reunion.messages, complet] };
  }
}

function envoiDemo(sessionId: string): EnvoiReunion {
  return AGENTS_DEMO.some((a) => a.id === sessionId)
    ? { sessionId, ok: true }
    : { sessionId, ok: false, erreur: 'session inconnue' };
}

function titre(texte: string): string {
  const ligne = texte.trim().split('\n')[0]?.trim() || 'Réunion';
  return ligne.length > SUJET_MAX ? `${ligne.slice(0, SUJET_MAX)}…` : ligne;
}

function extrait(texte: string): string {
  return texte.length > EXTRAIT_MAX ? `${texte.slice(0, EXTRAIT_MAX)}…` : texte;
}

function analyser(texte: string, statut: number): unknown {
  if (!texte) return {};
  try {
    return JSON.parse(texte);
  } catch {
    throw new ErreurRelais(statut, 'réponse de la salle illisible');
  }
}

function messageDErreur(donnees: unknown, statut: number): string {
  if (typeof donnees === 'object' && donnees !== null && 'erreur' in donnees) {
    const { erreur } = donnees;
    if (typeof erreur === 'string') return erreur;
  }
  return `erreur ${statut}`;
}
