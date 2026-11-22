// Responsabilité : ce que le nœud sait des autres nœuds, en mémoire seulement — leurs sessions (fiches reçues), leur
// présence et le fil récemment lu. Rien de cela n'entre dans la base du relais : quitter le nœud efface tout.
import type { ResumeSession } from '../../commun/session.ts';
import { TAILLE_FIL_FEDERE, type EvenementFedere, type MachineAnnoncee } from '../../commun/federation.ts';

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
}

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
  observateur: ObservateurDistant | null = null;

  /** Un nœud connu, en ligne ou non ; ses sessions restent visibles hors ligne jusqu'à sa révocation. */
  connaitre(membre: string, nom: string): void {
    const existant = this.noeuds.get(membre);
    if (existant) existant.nom = nom;
    else this.noeuds.set(membre, { nom, machine: nom, enLigne: false, sessions: new Map(), vue: null });
    this.observateur?.changement();
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
    for (const cle of [...this.fils.keys()]) if (cle.startsWith(`${membre}/`)) this.fils.delete(cle);
    this.observateur?.changement();
  }

  /** Une session que ce nœud vient d'ouvrir chez un pair : connue tout de suite, avant son prochain instantané. */
  ajouterSession(membre: string, session: ResumeSession): void {
    const noeud = this.noeuds.get(membre);
    if (!noeud) return;
    noeud.sessions.set(session.id, session);
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
