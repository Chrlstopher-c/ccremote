// Responsabilité : les postes connectés au relais — authentification, comptes rendus reçus, commandes envoyées.
// Un poste rend compte de SES sessions et n'a aucun moyen de commander quoi que ce soit.
import type { ServerWebSocket } from 'bun';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import { type CommandeRelais, ENTETE_MACHINE, MessagePoste } from '../../commun/protocole-poste.ts';
import type { Diffusion, VueMachine } from '../clients/diffusion.ts';
import { notificationPour } from '../notifications/regles.ts';
import type { Registre } from '../registre/registre.ts';

export interface DonneesPoste { readonly machine: string }
export interface ReponsePoste { readonly ok: boolean; readonly erreur?: string; readonly donnees?: unknown }
type SansId<T> = T extends unknown ? Omit<T, 'id'> : never;

const DELAI_REPONSE_MS = 20_000;

export class Postes {
  private readonly connectes = new Map<string, ServerWebSocket<DonneesPoste>>();
  private readonly enAttente = new Map<string, (r: ReponsePoste) => void>();

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
    return this.registre.machines().map((m) => ({ ...m, enLigne: this.enLigne(m.id) }));
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
    this.diffuserMachine(ws.data.machine);
  }

  commander(machine: string, commande: SansId<CommandeRelais>): Promise<ReponsePoste> {
    const ws = this.connectes.get(machine);
    if (!ws) return Promise.resolve({ ok: false, erreur: `${machine} est hors ligne` });
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
    if (m.kind === 'bonjour') return this.bonjour(machine, m);
    if (m.kind === 'etat_machine') {
      this.registre.majEtatMachine(machine, m.etat);
      return this.diffuserMachine(machine);
    }
    const sessionId = m.kind === 'session' ? m.session.id : m.sessionId;
    if (!this.appartient(sessionId, machine) || (m.kind === 'session' && m.session.machine !== machine)) {
      this.journal.warn({ machine, sessionId }, 'compte rendu refusé : session d’une autre machine');
      return;
    }
    if (m.kind === 'flux') return; // plus émis depuis le passage au TUI : le fil vient du transcript
    if (m.kind === 'session') {
      this.registre.enregistrerSession(m.session);
      return this.diffusion.diffuser({ type: 'session', session: m.session });
    }
    this.evenement(sessionId, m.ts, m.evt);
  }

  private bonjour(machine: string, m: Extract<MessagePoste, { kind: 'bonjour' }>): void {
    this.registre.enregistrerMachine({ id: machine, description: m.description, racines: m.racines, projets: m.projets,
      comptes: m.comptes, version: m.version, derniereVue: new Date().toISOString() });
    for (const s of m.sessions) {
      if (s.machine !== machine || !this.appartient(s.id, machine)) continue;
      this.registre.enregistrerSession(s);
      this.diffusion.diffuser({ type: 'session', session: s });
    }
    this.diffuserMachine(machine);
  }

  private evenement(sessionId: string, ts: string, evt: Extract<MessagePoste, { kind: 'evenement' }>['evt']): void {
    const e = this.registre.ajouterEvenement(sessionId, ts, evt);
    this.diffusion.diffuser({ type: 'evenement', evenement: e });
    const titre = this.registre.session(sessionId)?.titre ?? 'Session';
    const brouillon = notificationPour(titre, evt);
    if (!brouillon) return;
    const notification = this.registre.ajouterNotification({ ...brouillon, sessionId, ts });
    this.diffusion.diffuser({ type: 'notification', notification });
  }

  // Une session inconnue est acceptée (le compte rendu peut précéder l'enregistrement) ; celle d'une autre machine, jamais.
  private appartient(sessionId: string, machine: string): boolean {
    const s = this.registre.session(sessionId);
    return s === null || s.machine === machine;
  }

  private diffuserMachine(machine: string): void {
    const vue = this.vues().find((v) => v.id === machine);
    if (vue) this.diffusion.diffuser({ type: 'machine', machine: vue });
  }
}
