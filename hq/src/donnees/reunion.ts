// Responsabilité : la salle de réunion côté HQ — lister, ouvrir, envoyer une demande de Chris. Miroir typé de
// commun/reunion.ts (hq n'importe rien d'autre que lui-même). Deux sources : le relais réel (HTTP, jeton porteur)
// et une démo qui simule deux sessions. Les erreurs remontent en ErreurRelais, comme le reste du dossier.
import type { ResumeSession } from './contrat';
import { SCENARIO_SESSIONS } from './demo-scenario';
import { sessionALInstant } from './demo-simulation';
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

export type FournisseurSessions = () => readonly ResumeSession[];

const DELAI_PREMIERE_MS = 1_000;
const DELAI_ENTRE_MS = 1_000;
const SUJET_MAX = 60;
const EXTRAIT_MAX = 40;

// Sans fournisseur : les sessions du scénario de démo, figées à l'heure de création.
export function creerReunionsDemo(
  maintenant: () => Date = () => new Date(),
  sessions: FournisseurSessions = sessionsDuScenario(maintenant),
): ApiReunions {
  return new ReunionsDemo(maintenant, sessions);
}

function sessionsDuScenario(maintenant: () => Date): FournisseurSessions {
  const t0 = maintenant().getTime();
  return () => SCENARIO_SESSIONS.map((def) => sessionALInstant(def, t0, maintenant().getTime()));
}

interface ReponseEnAttente {
  readonly reunionId: string;
  readonly a: number;
  readonly auteur: string;
  readonly texte: string;
}

// Démo : chaque session choisie répond une fois, après un délai lu sur l'horloge injectée ; aucun appel au relais.
class ReunionsDemo implements ApiReunions {
  private readonly reunions = new Map<string, Reunion>();
  private attente: ReponseEnAttente[] = [];
  private compteur = 0;

  constructor(
    private readonly maintenant: () => Date,
    private readonly sessions: FournisseurSessions,
  ) {}

  async lister(): Promise<readonly Reunion[]> {
    this.livrer();
    return [...this.reunions.values()];
  }

  async ouvrir(id: string): Promise<Reunion> {
    this.livrer();
    return this.trouver(id);
  }

  async envoyer(demande: DemandeReunion): Promise<ReponseReunion> {
    this.livrer();
    const existante = demande.reunionId === undefined ? null : this.trouver(demande.reunionId);
    const connues = this.sessions();
    const cibles = demande.destinataires === 'auto' ? cibleAuto(demande.texte, connues) : [...demande.destinataires];
    const envois = cibles.map((id) => envoiDemo(id, connues));
    const reelles = envois.filter((e) => e.ok).map((e) => e.sessionId);
    const depart = existante ?? this.nouvelle(demande.texte);
    const message = { auteur: AUTEUR_CHRIS, texte: demande.texte, destinataires: reelles };
    let reunion = this.ajouter(depart, message, this.maintenant());
    reunion = { ...reunion, participants: [...new Set([...reunion.participants, ...reelles])] };
    this.reunions.set(reunion.id, reunion);
    this.programmer(reunion.id, demande.texte, reelles, connues);
    return { reunion, envois };
  }

  private programmer(
    reunionId: string,
    texte: string,
    ids: readonly string[],
    connues: readonly ResumeSession[],
  ): void {
    const depart = this.maintenant().getTime();
    ids.forEach((id, rang) => {
      const session = connues.find((s) => s.id === id);
      if (!session) return;
      const reponse = `${session.projet.nom} : bien reçu, « ${extrait(texte)} ».`;
      const a = depart + DELAI_PREMIERE_MS + rang * DELAI_ENTRE_MS;
      this.attente.push({ reunionId, a, auteur: id, texte: reponse });
    });
  }

  private livrer(): void {
    const now = this.maintenant().getTime();
    const prets = this.attente.filter((r) => r.a <= now).sort((x, y) => x.a - y.a);
    if (prets.length === 0) return;
    this.attente = this.attente.filter((r) => r.a > now);
    for (const r of prets) {
      const reunion = this.reunions.get(r.reunionId);
      if (!reunion) continue;
      const message = { auteur: r.auteur, texte: r.texte, destinataires: [] };
      this.reunions.set(r.reunionId, this.ajouter(reunion, message, new Date(r.a)));
    }
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
    ts: Date,
  ): Reunion {
    this.compteur += 1;
    const complet: MessageReunion = { id: `demo-message-${this.compteur}`, ts: ts.toISOString(), ...message };
    return { ...reunion, messages: [...reunion.messages, complet] };
  }
}

// Auto : sessions actives (ni archivées, ni fermées) citées par projet ou titre ; à défaut, toutes les actives.
function cibleAuto(texte: string, sessions: readonly ResumeSession[]): string[] {
  const actives = sessions.filter((s) => !s.archivee && s.statut !== 'fermee');
  const bas = texte.toLowerCase();
  const citees = actives.filter((s) => cite(bas, s.projet.nom) || cite(bas, s.titre));
  return (citees.length > 0 ? citees : actives).map((s) => s.id);
}

function cite(texteBas: string, mot: string): boolean {
  const cherche = mot.trim().toLowerCase();
  return cherche.length > 0 && texteBas.includes(cherche);
}

function envoiDemo(sessionId: string, connues: readonly ResumeSession[]): EnvoiReunion {
  return connues.some((s) => s.id === sessionId)
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
