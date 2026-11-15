// Responsabilité : la démo vivante — les sessions que Chris touche sortent du scénario et réagissent à ses actions.
// Chaque changement part comme un message client (événement ou session), sur l'horloge et le planificateur injectés.
import type {
  ActionSession,
  Evenement,
  EvenementDate,
  MessageClient,
  ReponseDialogue,
  ResumeSession,
} from './contrat';
import { type Etape, planTour, resumeReponse } from './demo-vivante-plan';

export type PlanificateurUnique = (fn: () => void, ms: number) => () => void;

export interface OptionsVivante {
  readonly horloge: () => number;
  readonly planifier: PlanificateurUnique;
  readonly base: (sessionId: string) => ResumeSession | undefined;
  readonly emettre: (message: MessageClient) => void;
}

type ActionSimple = Exclude<ActionSession, 'archiver' | 'desarchiver'>;

const SEQ_DEPART_VIVANT = 1_000_000_000;
const FRACTION_APRES_COMPACTION = 0.35;

// Identifiant de session d'un message client, `null` quand le message n'en porte pas (machine, écho, réunion).
export function sessionDuMessage(message: MessageClient): string | null {
  switch (message.type) {
    case 'evenement':
      return message.evenement.sessionId;
    case 'session':
      return message.session.id;
    case 'notification':
      return message.notification.sessionId;
    default:
      return null;
  }
}

export class DemoVivante {
  private readonly prises = new Map<string, ResumeSession>();
  private readonly annulations = new Map<string, Array<() => void>>();
  private seq = SEQ_DEPART_VIVANT;

  constructor(private readonly options: OptionsVivante) {}

  estPrise(sessionId: string): boolean {
    return this.prises.has(sessionId);
  }

  priseDe(sessionId: string): ResumeSession | undefined {
    return this.prises.get(sessionId);
  }

  // Prend la session en main avec des champs précis (ex. une question déjà posée au démarrage), sans rien émettre.
  prendre(sessionId: string, patch: Partial<ResumeSession>): void {
    const session = this.lire(sessionId);
    this.prises.set(sessionId, { ...session, ...patch });
  }

  envoyer(sessionId: string, texte: string): void {
    this.lire(sessionId);
    this.annuler(sessionId);
    this.emettreEvenement(sessionId, { type: 'message', texte });
    this.jouerTour(sessionId, { statut: 'travail' });
  }

  repondre(sessionId: string, reponse: ReponseDialogue): void {
    const session = this.lire(sessionId);
    if (!session.dialogue) throw new Error(`aucune question en attente pour ${sessionId}`);
    this.annuler(sessionId);
    this.emettreEvenement(sessionId, { type: 'message', texte: resumeReponse(session.dialogue, reponse) });
    this.jouerTour(sessionId, { statut: 'travail', dialogue: null });
  }

  agir(sessionId: string, action: ActionSession): void {
    const session = this.lire(sessionId);
    if (action === 'archiver' || action === 'desarchiver') {
      this.modifier(sessionId, { archivee: action === 'archiver' });
      return;
    }
    this.annuler(sessionId);
    this.appliquerAction(sessionId, session, action);
  }

  arreter(): void {
    for (const liste of this.annulations.values()) for (const annuler of liste) annuler();
    this.annulations.clear();
  }

  private appliquerAction(sessionId: string, session: ResumeSession, action: ActionSimple): void {
    switch (action) {
      case 'interrompre':
        this.emettreEvenement(sessionId, { type: 'relance', raison: 'Interrompu par Chris' });
        this.modifier(sessionId, { statut: 'attente' });
        return;
      case 'compacter':
        this.compacter(sessionId, session);
        return;
      case 'fermer':
        this.modifier(sessionId, { statut: 'fermee', tmux: null });
        return;
      case 'reprendre':
        this.modifier(sessionId, { statut: 'attente', tmux: `demo-${sessionId}` });
        return;
    }
  }

  private compacter(sessionId: string, session: ResumeSession): void {
    const avant = session.contexte.tokens;
    const apres = Math.round(avant * FRACTION_APRES_COMPACTION);
    this.emettreEvenement(sessionId, { type: 'compaction', avant, apres, declencheur: 'manuel' });
    this.modifier(sessionId, {
      contexte: { tokens: apres, max: session.contexte.max },
      compactions: session.compactions + 1,
    });
  }

  private jouerTour(sessionId: string, patch: Partial<ResumeSession>): void {
    this.modifier(sessionId, patch);
    for (const etape of planTour(this.seq)) this.programmer(sessionId, etape);
  }

  private programmer(sessionId: string, etape: Etape): void {
    const annuler = this.options.planifier(() => this.executer(sessionId, etape), etape.delaiMs);
    this.annulations.set(sessionId, [...(this.annulations.get(sessionId) ?? []), annuler]);
  }

  private executer(sessionId: string, etape: Etape): void {
    for (const evt of etape.evenements) this.emettreEvenement(sessionId, evt);
    if (etape.patch) this.modifier(sessionId, etape.patch);
  }

  private annuler(sessionId: string): void {
    for (const annuler of this.annulations.get(sessionId) ?? []) annuler();
    this.annulations.delete(sessionId);
  }

  // Session prise en main au premier geste ; inconnue du scénario = erreur, comme un relais qui ne la connaît pas.
  private lire(sessionId: string): ResumeSession {
    const existante = this.prises.get(sessionId);
    if (existante) return existante;
    const base = this.options.base(sessionId);
    if (!base) throw new Error(`session inconnue : ${sessionId}`);
    this.prises.set(sessionId, base);
    return base;
  }

  private modifier(sessionId: string, patch: Partial<ResumeSession>): void {
    const maj: ResumeSession = { ...this.lire(sessionId), ...patch, majLe: this.iso() };
    this.prises.set(sessionId, maj);
    this.options.emettre({ type: 'session', session: maj });
  }

  private emettreEvenement(sessionId: string, evt: Evenement): void {
    this.seq += 1;
    const evenement: EvenementDate = { seq: this.seq, sessionId, ts: this.iso(), evt };
    this.options.emettre({ type: 'evenement', evenement });
  }

  private iso(): string {
    return new Date(this.options.horloge()).toISOString();
  }
}
