// Responsabilité : le magasin observable de l'état du monde (machines, sessions, fil par session, notifications).
// Pur TypeScript, sans rendu ni horloge : un abonné n'est prévenu que si la valeur qu'il regarde change.
import type { EtatRelais, EvenementDate, MessageClient, Notification, ResumeSession, VueMachine } from './contrat';
import { journaliser } from './journal';
import type { EtatLien } from './source-monde';

export interface EtatMonde {
  readonly version: number;
  readonly lien: EtatLien;
  readonly machines: readonly VueMachine[];
  readonly sessions: readonly ResumeSession[];
  readonly notifications: readonly Notification[];
  readonly fil: Readonly<Record<string, readonly EvenementDate[]>>;
}

export interface TaillesMagasin {
  readonly fil: number;
  readonly notifications: number;
}

export const TAILLES_PAR_DEFAUT: TaillesMagasin = { fil: 300, notifications: 100 };

export type Selecteur<T> = (etat: EtatMonde) => T;
export type Ecouteur<T> = (valeur: T, precedente: T) => void;

const ETAT_INITIAL: EtatMonde = {
  version: 0,
  lien: 'connexion',
  machines: [],
  sessions: [],
  notifications: [],
  fil: {},
};

export class MagasinMonde {
  private etat: EtatMonde = ETAT_INITIAL;
  private readonly verifications = new Set<() => void>();

  constructor(private readonly tailles: TaillesMagasin = TAILLES_PAR_DEFAUT) {}

  lire(): EtatMonde {
    return this.etat;
  }

  // Renvoie la fonction qui désabonne. `egal` compare deux valeurs successives (Object.is par défaut).
  abonner<T>(selecteur: Selecteur<T>, ecouteur: Ecouteur<T>, egal: (a: T, b: T) => boolean = Object.is): () => void {
    let valeur = selecteur(this.etat);
    const verifier = (): void => {
      const suivante = selecteur(this.etat);
      if (egal(valeur, suivante)) return;
      const precedente = valeur;
      valeur = suivante;
      ecouteur(suivante, precedente);
    };
    this.verifications.add(verifier);
    return () => {
      this.verifications.delete(verifier);
    };
  }

  initialiser(relais: EtatRelais): void {
    this.mettre({
      version: relais.version,
      machines: [...relais.machines],
      sessions: [...relais.sessions],
      notifications: bornerListe(relais.notifications, this.tailles.notifications),
    });
  }

  definirLien(lien: EtatLien): void {
    this.mettre({ lien });
  }

  chargerFil(sessionId: string, evenements: readonly EvenementDate[]): void {
    this.mettre({ fil: { ...this.etat.fil, [sessionId]: this.fusionner(sessionId, evenements) } });
  }

  appliquer(message: MessageClient): void {
    switch (message.type) {
      case 'evenement':
        this.chargerFil(message.evenement.sessionId, [message.evenement]);
        return;
      case 'session':
        this.mettre({ sessions: remplacerOuAjouter(this.etat.sessions, message.session) });
        return;
      case 'machine':
        this.mettre({ machines: remplacerOuAjouter(this.etat.machines, message.machine) });
        return;
      case 'notification':
        this.ajouterNotification(message.notification);
        return;
      case 'echo':
        return;
    }
  }

  private ajouterNotification(notification: Notification): void {
    if (this.etat.notifications.some((n) => n.seq === notification.seq)) return;
    const suite = [...this.etat.notifications, notification];
    this.mettre({ notifications: bornerListe(suite, this.tailles.notifications) });
  }

  // Tri par seq, dédoublonnage par seq, bornage aux plus récents.
  private fusionner(sessionId: string, nouveaux: readonly EvenementDate[]): EvenementDate[] {
    const existants = this.etat.fil[sessionId] ?? [];
    const parSeq = new Map<number, EvenementDate>();
    for (const e of [...existants, ...nouveaux]) parSeq.set(e.seq, e);
    const ordonnes = [...parSeq.values()].sort((a, b) => a.seq - b.seq);
    return bornerListe(ordonnes, this.tailles.fil);
  }

  private mettre(partiel: Partial<EtatMonde>): void {
    this.etat = { ...this.etat, ...partiel };
    for (const verifier of [...this.verifications]) {
      try {
        verifier();
      } catch (erreur) {
        journaliser('error', 'abonné du monde en erreur', { erreur: String(erreur) });
      }
    }
  }
}

function bornerListe<T>(liste: readonly T[], taille: number): T[] {
  return liste.slice(Math.max(0, liste.length - taille));
}

// Remplace l'élément de même id, ou l'ajoute en fin de liste.
function remplacerOuAjouter<T extends { readonly id: string }>(liste: readonly T[], element: T): T[] {
  const existe = liste.some((x) => x.id === element.id);
  if (!existe) return [...liste, element];
  return liste.map((x) => (x.id === element.id ? element : x));
}
