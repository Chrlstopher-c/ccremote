// Responsabilité : ce que le nœud sait des autres nœuds — leurs sessions (fiches reçues), leur présence et le fil
// récemment lu. Rien n'entre dans la base du relais ; seule la dernière liste de sessions de chaque nœud est gardée sur
// disque (memoire-distante.ts), pour rester visible au redémarrage pendant que ce nœud est éteint.
import type { ConfirmationDemandee } from '../../commun/api-clients.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { MemoireDistante } from './memoire-distante.ts';
import {
  TAILLE_FIL_FEDERE,
  type EvenementFedere,
  type MachineAnnoncee,
  type MessageChiffre,
} from '../../commun/federation.ts';

/** Ce qu'on sait d'un nœud apparié : sa machine, son nom, sa présence, ses sessions et sa machine annoncée. */
export interface NoeudDistant {
  readonly membre: string;
  readonly nom: string;
  readonly machine: string;
  readonly enLigne: boolean;
  readonly sessions: readonly ResumeSession[];
  readonly vue: MachineAnnoncee | null;
}

/** Observe le cache : un nœud a changé (liste, présence), ou un événement en direct est arrivé. */
export interface ObservateurDistant {
  changement(): void;
  evenement(membre: string, session: string, evenement: EvenementFedere): void;
  /** Un delta de texte en cours d'écriture chez un pair (non cache : relayé en direct). */
  flux(membre: string, message: FluxDistant): void;
  /** Une confirmation d'un pair : nouvelle, ou son état a changé. */
  confirmation(membre: string, confirmation: ConfirmationDemandee): void;
}

/** Confirmations de pairs gardées en mémoire : au-delà, les réglées sont oubliées en premier. */
const CONFIRMATIONS_MAX = 200;

/** Le delta d'un bloc tel qu'un pair l'envoie (la session est celle du message). */
export type FluxDistant = Extract<MessageChiffre, { t: 'flux' }>;

export interface SessionDistante {
  readonly membre: string;
  readonly nom: string;
  readonly machine: string;
  readonly enLigne: boolean;
  readonly session: ResumeSession;
}

interface EtatNoeud {
  nom: string;
  machine: string;
  enLigne: boolean;
  sessions: Map<string, ResumeSession>;
  vue: MachineAnnoncee | null;
}

export class CacheDistant {
  private readonly noeuds = new Map<string, EtatNoeud>();
  private readonly fils = new Map<string, EvenementFedere[]>();
  private readonly confirmations = new Map<string, { membre: string; confirmation: ConfirmationDemandee }>();
  observateur: ObservateurDistant | null = null;

  constructor(private readonly memoire: MemoireDistante | null = null) {}

  /**
   * Un nœud connu, en ligne ou non ; ses sessions restent visibles hors ligne jusqu'à sa révocation, et au redémarrage
   * de ce nœud elles reviennent de la dernière liste gardée sur disque.
   */
  connaitre(membre: string, nom: string): void {
    const existant = this.noeuds.get(membre);
    if (existant) existant.nom = nom;
    else {
      const garde = this.memoire?.noeud(membre) ?? null;
      this.noeuds.set(membre, {
        nom,
        machine: garde?.machine ?? nom,
        enLigne: false,
        sessions: new Map((garde?.sessions ?? []).map((s) => [s.id, s])),
        vue: null,
      });
    }
    this.observateur?.changement();
  }

  private memoriser(): void {
    if (!this.memoire) return;
    this.memoire.ecrire(
      Object.fromEntries(
        [...this.noeuds].map(([membre, n]) => [
          membre,
          { nom: n.nom, machine: n.machine, sessions: [...n.sessions.values()] },
        ]),
      ),
    );
  }

  instantane(
    membre: string,
    machine: string,
    nom: string,
    sessions: readonly ResumeSession[],
    vue: MachineAnnoncee | null = null,
  ): void {
    this.noeuds.set(membre, {
      nom,
      machine,
      enLigne: true,
      sessions: new Map(sessions.map((s) => [s.id, s])),
      vue,
    });
    this.memoriser();
    this.observateur?.changement();
  }

  enLigne(membre: string, enLigne: boolean): void {
    const noeud = this.noeuds.get(membre);
    if (!noeud || noeud.enLigne === enLigne) return;
    noeud.enLigne = enLigne;
    this.observateur?.changement();
  }

  retirer(membre: string): void {
    this.noeuds.delete(membre);
    this.memoriser();
    for (const cle of [...this.fils.keys()]) if (cle.startsWith(`${membre}/`)) this.fils.delete(cle);
    for (const [id, e] of this.confirmations) {
      if (e.membre !== membre || e.confirmation.statut !== 'en_attente') continue;
      this.recevoirConfirmation(membre, { ...e.confirmation, statut: 'expiree' });
    }
    this.observateur?.changement();
  }

  /** Une confirmation d'un pair : gardée (pour répondre à son nœud), et annoncée à l'interface. */
  recevoirConfirmation(membre: string, confirmation: ConfirmationDemandee): void {
    this.confirmations.set(confirmation.id, { membre, confirmation });
    this.elaguerConfirmations();
    this.observateur?.confirmation(membre, confirmation);
  }

  /** Le nœud qui a demandé cette confirmation (y répondre l'y fait parvenir), ou null si elle n'est pas d'un pair. */
  membreDeConfirmation(id: string): string | null {
    return this.confirmations.get(id)?.membre ?? null;
  }

  /** Vrai pour toute confirmation venue d'un pair, réglée ou non : jamais renvoyée à nouveau. */
  estConfirmationDistante(id: string): boolean {
    return this.confirmations.has(id);
  }

  private elaguerConfirmations(): void {
    for (const [id, e] of this.confirmations) {
      if (this.confirmations.size <= CONFIRMATIONS_MAX) return;
      if (e.confirmation.statut !== 'en_attente') this.confirmations.delete(id);
    }
  }

  /** Une session que ce nœud vient d'ouvrir chez un pair : connue tout de suite, avant son prochain instantané. */
  ajouterSession(membre: string, session: ResumeSession): void {
    const noeud = this.noeuds.get(membre);
    if (!noeud) return;
    noeud.sessions.set(session.id, session);
    this.memoriser();
    this.observateur?.changement();
  }

  /** Les nœuds connus, avec leurs sessions (ordre d'arrivée). */
  noeudsConnus(): NoeudDistant[] {
    return [...this.noeuds].map(([membre, n]) => ({
      membre,
      nom: n.nom,
      machine: n.machine,
      enLigne: n.enLigne,
      sessions: [...n.sessions.values()],
      vue: n.vue,
    }));
  }

  sessions(): SessionDistante[] {
    return [...this.noeuds].flatMap(([membre, n]) =>
      [...n.sessions.values()].map((session) => ({
        membre,
        nom: n.nom,
        machine: n.machine,
        enLigne: n.enLigne,
        session,
      })),
    );
  }

  session(membre: string, session: string): ResumeSession | null {
    return this.noeuds.get(membre)?.sessions.get(session) ?? null;
  }

  fil(membre: string, session: string): EvenementFedere[] {
    return this.fils.get(cleFil(membre, session)) ?? [];
  }

  remplacerFil(membre: string, session: string, evenements: readonly EvenementFedere[]): void {
    this.fils.set(cleFil(membre, session), evenements.slice(-TAILLE_FIL_FEDERE));
  }

  /** Un delta reçu d'un pair : rien n'est gardé, il part vers l'interface si la session est bien la sienne. */
  recevoirFlux(membre: string, message: FluxDistant): void {
    this.observateur?.flux(membre, message);
  }

  ajouterEvenement(membre: string, session: string, evenement: EvenementFedere): void {
    const cle = cleFil(membre, session);
    const actuel = this.fils.get(cle) ?? [];
    this.fils.set(cle, [...actuel, evenement].slice(-TAILLE_FIL_FEDERE));
    this.observateur?.evenement(membre, session, evenement);
  }
}

function cleFil(membre: string, session: string): string {
  return `${membre}/${session}`;
}
