// Responsabilité : l'état de l'app (parc, sessions, fils, notifications), tenu à jour par le flux du relais.
// À chaque (re)connexion du flux, tout est relu : aucun événement manqué pendant une coupure.
import type { EvenementDate, MessageClient, Notification, VueMachine } from '../../../../commun/api-clients.ts';
import type { ResumeSession } from '../../../../commun/session.ts';
import type { MessageEcho } from '../../../../commun/echo.ts';
import type { ClientRelais } from '../api/client.ts';
import { type EtatLien, FluxRelais } from '../api/flux.ts';
import { journal } from '../journal.ts';

export interface Etat {
  readonly lien: EtatLien;
  readonly machines: readonly VueMachine[];
  readonly sessions: readonly ResumeSession[];
  readonly notifications: readonly Notification[];
  readonly reveilPossible: readonly string[];
  readonly fils: ReadonlyMap<string, readonly EvenementDate[]>;
}

const VIDE: Etat = {
  lien: 'connexion',
  machines: [],
  sessions: [],
  notifications: [],
  reveilPossible: [],
  fils: new Map(),
};

// Une machine hors ligne n'a plus de session vivante (éteinte, ou son poste injoignable) : ses sessions sont présentées
// fermées. Dès que le poste se reconnecte, le relais renvoie leur état réel.
function deriver(brutes: readonly ResumeSession[], machines: readonly VueMachine[]): ResumeSession[] {
  const horsLigne = new Set(machines.filter((m) => !m.enLigne).map((m) => m.id));
  const fermee = (s: ResumeSession): ResumeSession => ({
    ...s, tmux: null, terminal: false, attachee: false, statut: 'fermee',
  });
  return brutes.map((s) => (horsLigne.has(s.machine) && (s.tmux !== null || s.terminal) ? fermee(s) : s));
}

export class Magasin {
  private etat: Etat = VIDE;
  private brutes: readonly ResumeSession[] = [];
  private readonly abonnes = new Set<() => void>();
  private readonly flux: FluxRelais;
  private readonly surNotification = new Set<(n: Notification) => void>();
  private readonly surEcho = new Set<(m: MessageEcho) => void>();

  constructor(readonly client: ClientRelais) {
    this.flux = new FluxRelais(
      client.urlFlux(),
      client.jetonFlux,
      (m) => this.recevoir(m),
      (lien) => {
        this.changer({ lien });
        if (lien === 'ouvert') void this.recharger();
      },
    );
  }

  demarrer(): void {
    this.flux.demarrer();
  }

  arreter(): void {
    this.flux.arreter();
  }

  lire = (): Etat => this.etat;

  abonner = (f: () => void): (() => void) => {
    this.abonnes.add(f);
    return () => this.abonnes.delete(f);
  };

  ecouterEcho(f: (m: MessageEcho) => void): () => void {
    this.surEcho.add(f);
    return () => this.surEcho.delete(f);
  }

  ecouterNotifications(f: (n: Notification) => void): () => void {
    this.surNotification.add(f);
    return () => this.surNotification.delete(f);
  }

  async chargerFil(sessionId: string): Promise<void> {
    const connu = this.etat.fils.get(sessionId);
    const dernier = connu?.at(-1)?.seq;
    try {
      const nouveaux = await this.client.evenements(sessionId, dernier);
      this.fusionnerFil(sessionId, nouveaux, dernier === undefined);
    } catch (erreur) {
      journal.warn({ sessionId, erreur: String(erreur) }, 'fil non chargé');
    }
  }

  private async recharger(): Promise<void> {
    try {
      const e = await this.client.etat();
      this.brutes = e.sessions;
      this.changer({
        machines: e.machines,
        sessions: deriver(e.sessions, e.machines),
        notifications: e.notifications,
        reveilPossible: e.reveilPossible,
      });
      await Promise.all([...this.etat.fils.keys()].map((id) => this.chargerFil(id)));
    } catch (erreur) {
      journal.warn({ erreur: String(erreur) }, 'état du relais non chargé');
    }
  }

  private recevoir(m: MessageClient): void {
    if (m.type === 'machine') {
      const machines = remplacer(this.etat.machines, m.machine, (x) => x.id);
      this.changer({ machines, sessions: deriver(this.brutes, machines) });
    } else if (m.type === 'session') {
      this.brutes = remplacer(this.brutes, m.session, (x) => x.id);
      this.changer({ sessions: deriver(this.brutes, this.etat.machines) });
    }
    else if (m.type === 'evenement') {
      if (this.etat.fils.has(m.evenement.sessionId)) this.fusionnerFil(m.evenement.sessionId, [m.evenement], false);
    } else if (m.type === 'echo') {
      for (const f of this.surEcho) f(m.echo);
    } else {
      this.changer({ notifications: [m.notification, ...this.etat.notifications].slice(0, 200) });
      for (const f of this.surNotification) f(m.notification);
    }
  }

  private fusionnerFil(sessionId: string, nouveaux: readonly EvenementDate[], remplacerTout: boolean): void {
    const avant = remplacerTout ? [] : (this.etat.fils.get(sessionId) ?? []);
    const dernier = avant.at(-1)?.seq ?? 0;
    const suite = [...avant, ...nouveaux.filter((e) => e.seq > dernier)];
    const fils = new Map(this.etat.fils);
    fils.set(sessionId, suite.slice(-2_000));
    this.changer({ fils });
  }

  private changer(p: Partial<Etat>): void {
    this.etat = { ...this.etat, ...p };
    for (const f of this.abonnes) f();
  }
}

function remplacer<T>(liste: readonly T[], el: T, cle: (x: T) => string): T[] {
  const i = liste.findIndex((x) => cle(x) === cle(el));
  if (i < 0) return [el, ...liste];
  const copie = [...liste];
  copie[i] = el;
  return copie;
}
