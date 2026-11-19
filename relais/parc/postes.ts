// Responsabilité : les postes connectés au relais — authentification, comptes rendus reçus, commandes envoyées.
// Un poste rend compte de SES sessions et n'a aucun moyen de commander quoi que ce soit.
import type { ServerWebSocket } from 'bun';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import { type CommandeRelais, ENTETE_MACHINE, MessagePoste } from '../../commun/protocole-poste.ts';
import type { Evenement } from '../../commun/session.ts';
import type { AccesVue, VueInstallation, VueMachine } from '../../commun/api-clients.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import { notificationPour } from '../notifications/regles.ts';
import type { Registre } from '../registre/registre.ts';

export interface DonneesPoste {
  readonly machine: string;
}
export interface ReponsePoste {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}
type SansId<T> = T extends unknown ? Omit<T, 'id'> : never;

const DELAI_REPONSE_MS = 60_000; // une connexion de compte attend jusqu’à 30 s la confirmation du CLI

export class Postes {
  private readonly connectes = new Map<string, ServerWebSocket<DonneesPoste>>();
  private readonly enAttente = new Map<string, (r: ReponsePoste) => void>();
  /** Les terminaux à distance, branchés après coup (ils ont besoin des postes pour commander). */
  terminaux: {
    duPoste(machine: string, m: Extract<MessagePoste, { kind: `terminal_${string}` }>): void;
    posteDeconnecte(machine: string): void;
  } | null = null;
  /** La salle de réunion (HQ) : voit chaque événement d'une session pour recopier les réponses demandées. */
  reunions: { observer(sessionId: string, evt: Evenement): void } | null = null;
  /** L'accès de chaque machine (tunnel, installation) et les fiches des machines configurées sans poste. */
  acces: {
    de(machine: string): AccesVue;
    sansPoste(): VueMachine[];
    installation(machine: string): VueInstallation | null;
  } | null = null;
  /** Un poste s'est annoncé avec l'empreinte de son code : le relais peut le mettre à jour (une fois par connexion). */
  miseAJour: ((machine: string, empreinte: string | undefined) => void) | null = null;

  constructor(
    private readonly registre: Registre,
    private readonly diffusion: Diffusion,
    private readonly secrets: ReadonlyMap<string, string>,
    private readonly journal: Logger,
  ) {}

  authentifier(req: Request): string | null {
    const machine = req.headers.get(ENTETE_MACHINE) ?? '';
    const attendu = this.secrets.get(machine);
    const fourni = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!attendu || fourni.length !== attendu.length) return null;
    return timingSafeEqual(Buffer.from(fourni), Buffer.from(attendu)) ? machine : null;
  }

  enLigne(machine: string): boolean {
    return this.connectes.has(machine);
  }

  vues(): VueMachine[] {
    const postes = this.registre.machines().map((m) => ({
      ...m,
      enLigne: this.enLigne(m.id),
      ...(this.acces ? { acces: this.acces.de(m.id), installation: this.acces.installation(m.id) } : {}),
    }));
    return [...postes, ...(this.acces?.sansPoste() ?? [])];
  }

  /** Un changement d'accès (tunnel, installation) : les clients le reçoivent comme tout changement de machine. */
  rafraichirMachine(machine: string): void {
    this.diffuserMachine(machine);
  }

  ouvert(ws: ServerWebSocket<DonneesPoste>): void {
    this.connectes.get(ws.data.machine)?.close(4000, 'remplacé par une connexion plus récente');
    this.connectes.set(ws.data.machine, ws);
    this.journal.info({ machine: ws.data.machine }, 'poste connecté');
  }

  ferme(ws: ServerWebSocket<DonneesPoste>): void {
    if (this.connectes.get(ws.data.machine) !== ws) return;
    this.connectes.delete(ws.data.machine);
    this.journal.warn({ machine: ws.data.machine }, 'poste déconnecté');
    this.terminaux?.posteDeconnecte(ws.data.machine);
    this.diffuserMachine(ws.data.machine);
  }

  commander(machine: string, commande: SansId<CommandeRelais>): Promise<ReponsePoste> {
    const ws = this.connectes.get(machine);
    if (!ws) return Promise.resolve({ ok: false, erreur: this.messageHorsLigne(machine) });
    const id = randomUUID();
    return new Promise((resoudre) => {
      const minuteur = setTimeout(() => {
        this.enAttente.delete(id);
        resoudre({ ok: false, erreur: `${machine} n’a pas répondu` });
      }, DELAI_REPONSE_MS);
      this.enAttente.set(id, (r) => {
        clearTimeout(minuteur);
        resoudre(r);
      });
      ws.send(JSON.stringify({ ...commande, id }));
    });
  }

  private messageHorsLigne(machine: string): string {
    const acces = this.acces?.de(machine);
    if (acces?.etat !== 'injoignable') return `${machine} est hors ligne`;
    return `machine injoignable${acces.detail ? ` (${acces.detail})` : ''}`;
  }

  /** Sans attendre de réponse : la frappe dans un terminal. Machine hors ligne → perdu, et c'est voulu. */
  envoyer(machine: string, commande: SansId<CommandeRelais>): void {
    this.connectes.get(machine)?.send(JSON.stringify({ ...commande, id: '' }));
  }

  recu(ws: ServerWebSocket<DonneesPoste>, brut: string): void {
    const machine = ws.data.machine;
    let m: MessagePoste;
    try {
      m = MessagePoste.parse(JSON.parse(brut));
    } catch (erreur) {
      this.journal.warn({ machine, err: erreur }, 'message de poste illisible, ignoré');
      return;
    }
    this.traiter(machine, m);
  }

  private traiter(machine: string, m: MessagePoste): void {
    if (m.kind === 'reponse') return this.enAttente.get(m.id)?.(m);
    if (m.kind === 'terminal_sortie' || m.kind === 'terminal_fin') return this.terminaux?.duPoste(machine, m);
    if (m.kind === 'flux') return this.flux(machine, m);
    if (m.kind === 'bonjour') return this.bonjour(machine, m);
    if (m.kind === 'etat_machine') {
      this.registre.majEtatMachine(machine, m.etat);
      return this.diffuserMachine(machine);
    }
    if (m.kind === 'comptes') {
      this.registre.majComptes(machine, m.comptes);
      return this.diffuserMachine(machine);
    }
    const sessionId = m.kind === 'session' ? m.session.id : m.sessionId;
    if (!this.appartient(sessionId, machine) || (m.kind === 'session' && m.session.machine !== machine)) {
      this.journal.warn({ machine, sessionId }, 'compte rendu refusé : session d’une autre machine');
      return;
    }
    if (m.kind === 'session') {
      this.registre.enregistrerSession(m.session);
      return this.diffuserSession(m.session.id);
    }
    this.evenement(sessionId, m.ts, m.evt);
  }

  private bonjour(machine: string, m: Extract<MessagePoste, { kind: 'bonjour' }>): void {
    this.registre.enregistrerMachine({
      id: machine,
      description: m.description,
      racines: m.racines,
      projets: m.projets,
      comptes: m.comptes,
      version: m.version,
      derniereVue: new Date().toISOString(),
    });
    if (m.etatComptes) this.registre.majComptes(machine, m.etatComptes);
    for (const s of m.sessions) {
      if (s.machine !== machine || !this.appartient(s.id, machine)) continue;
      this.registre.enregistrerSession(s);
      this.diffuserSession(s.id);
    }
    this.fermerNonAnnoncees(machine, new Set(m.sessions.map((s) => s.id)));
    this.diffuserMachine(machine);
    this.miseAJour?.(machine, m.empreinte);
  }

  // Une session que le poste n'annonce plus n'a plus de processus qu'il suit : elle est fermée, pas laissée « en
  // attente » pour toujours.
  private fermerNonAnnoncees(machine: string, annoncees: ReadonlySet<string>): void {
    const maintenant = new Date().toISOString();
    for (const s of this.registre.sessions(true)) {
      if (s.machine !== machine || s.statut === 'fermee' || annoncees.has(s.id)) continue;
      this.journal.info({ machine, sessionId: s.id, statut: s.statut }, 'session absente de l’annonce : fermée');
      this.registre.enregistrerSession({ ...s, statut: 'fermee', majLe: maintenant });
      this.diffuserSession(s.id);
    }
  }

  // Delta en cours d'écriture : diffusé aux clients connectés, jamais persisté (le bloc final suit dans le fil).
  private flux(machine: string, m: Extract<MessagePoste, { kind: 'flux' }>): void {
    if (!this.appartient(m.sessionId, machine)) return;
    this.diffusion.diffuser({
      type: 'flux',
      sessionId: m.sessionId,
      bloc: m.bloc,
      delta: m.delta,
      ...(m.genre ? { genre: m.genre } : {}),
      ...(m.agent ? { agent: m.agent } : {}),
    });
  }

  private evenement(sessionId: string, ts: string, evt: Extract<MessagePoste, { kind: 'evenement' }>['evt']): void {
    const e = this.registre.ajouterEvenement(sessionId, ts, evt);
    this.diffusion.diffuser({ type: 'evenement', evenement: e });
    this.reunions?.observer(sessionId, evt);
    const fiche = this.registre.session(sessionId);
    if (fiche?.annexe_de) return; // une conversation annexe ne notifie pas Chris
    const titre = fiche?.titre ?? 'Session';
    const brouillon = notificationPour(titre, evt);
    if (!brouillon) return;
    const notification = this.registre.ajouterNotification({ ...brouillon, sessionId, ts });
    this.diffusion.diffuser({ type: 'notification', notification });
  }

  // Une session inconnue est acceptée (le compte rendu peut précéder l'enregistrement) ; celle d'une autre machine,
  // jamais.
  private appartient(sessionId: string, machine: string): boolean {
    const s = this.registre.session(sessionId);
    return s === null || s.machine === machine;
  }

  // La vue relue dans le registre : elle porte l'inactivité et le drapeau d'archivage, absents de la fiche du poste.
  private diffuserSession(sessionId: string): void {
    const session = this.registre.session(sessionId);
    if (session) this.diffusion.diffuser({ type: 'session', session });
  }

  private diffuserMachine(machine: string): void {
    const vue = this.vues().find((v) => v.id === machine);
    if (vue) this.diffusion.diffuser({ type: 'machine', machine: vue });
  }
}
