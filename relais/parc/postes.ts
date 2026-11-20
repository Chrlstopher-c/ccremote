// Responsabilité : les postes connectés au relais — authentification, comptes rendus reçus, commandes envoyées.
// Un poste rend compte de SES sessions et n'a aucun moyen de commander quoi que ce soit.
import type { ServerWebSocket } from 'bun';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import { type CommandeRelais, ENTETE_MACHINE, MessagePoste } from '../../commun/protocole-poste.ts';
import type { Decouverte } from '../../commun/decouverte.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { LimiteSdk } from '../../commun/comptes.ts';
import type { AccesVue, VueInstallation, VueMachine } from '../../commun/api-clients.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import { notificationPour } from '../notifications/regles.ts';
import { decouverteParIdentifiant } from './decouvertes-postes.ts';
import type { Registre } from '../registre/registre.ts';
import type { ReseauPoste, VersionsClaude } from '../../commun/entretien.ts';
import {
  avancerRelecture,
  cleEvenement,
  queueSansAncre,
  type EtatRelecture,
  type EvenementHorodate,
} from './fusion-historique.ts';

export interface DonneesPoste {
  readonly machine: string;
}
/** Ce qu'un poste annonce au bonjour, gardé le temps de sa connexion (versions, empreinte). */
export interface InfosPoste {
  readonly commit: string | null;
  readonly empreinte: string | null;
  readonly claudeCode: VersionsClaude | null;
}
export interface ReponsePoste {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}
type SansId<T> = T extends unknown ? Omit<T, 'id'> : never;

const DELAI_REPONSE_MS = 60_000; // une connexion de compte attend jusqu’à 30 s la confirmation du CLI
const ESSAI_JUMELLE_MS = 60_000; // une jumelle Remote Control introuvable est recherchée de nouveau après ce délai

export class Postes {
  private readonly connectes = new Map<string, ServerWebSocket<DonneesPoste>>();
  private readonly enAttente = new Map<string, (r: ReponsePoste) => void>();
  private surLimiteCompte: ((machine: string, cle: string, limite: LimiteSdk) => void) | null = null;

  /** Fenêtre de quota vue dans le flux SDK d'un poste : posée sur le relevé du compte (sans appel à l'API). */
  surCompteLimite(fn: (machine: string, cle: string, limite: LimiteSdk) => void): void {
    this.surLimiteCompte = fn;
  }
  // Sessions trouvées sur chaque poste connecté, pas encore ouvertes dans Lanterne : jamais persistées.
  private readonly decouvertesDuPoste = new Map<string, readonly Decouverte[]>();
  private readonly infos = new Map<string, InfosPoste>();
  // Session → où en est la relecture de son transcript (voir fusion-historique.ts).
  private readonly relectures = new Map<string, EtatRelecture>();
  // Session Remote Control → session de poste qui tient la même conversation (voir avecJumelle).
  private readonly jumelles = new Map<string, { jumelle: string | null; essai: number }>();
  // Sessions dont une relecture complète a été demandée au poste (queue sans l'ancre du fil) : une fois par session.
  private readonly relecturesCompletesDemandees = new Set<string>();
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
  /** Le réseau d'un poste (MAC, diffusion) relevé avec son état : le relais le retient pour le réveil. */
  reseauRecu: ((machine: string, reseau: ReseauPoste) => void) | null = null;
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

  infosPoste(machine: string): InfosPoste | null {
    return this.infos.get(machine) ?? null;
  }

  enLigne(machine: string): boolean {
    return this.connectes.has(machine);
  }

  /** Sessions découvertes sur les postes connectés, sans celles que le relais connaît déjà (fiche, identifiant SDK). */
  decouvertes(connues: ReadonlySet<string>): Decouverte[] {
    const candidates = [...this.decouvertesDuPoste.entries()]
      .filter(([machine]) => this.enLigne(machine))
      .flatMap(([machine, liste]) => liste.map((decouverte) => ({ machine, decouverte })));
    return decouverteParIdentifiant(candidates).filter((d) => !connues.has(d.id));
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
    this.decouvertesDuPoste.delete(ws.data.machine);
    this.infos.delete(ws.data.machine);
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
    if (m.kind === 'decouvertes') return void this.decouvertesDuPoste.set(machine, m.decouvertes);
    if (m.kind === 'etat_machine') {
      this.registre.majEtatMachine(machine, m.etat);
      if (m.etat.reseau) this.reseauRecu?.(machine, m.etat.reseau);
      return this.diffuserMachine(machine);
    }
    if (m.kind === 'compte_limite') return this.surLimiteCompte?.(machine, m.cle, m.limite);
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
      this.registre.enregistrerSession(this.avecJumelle(m.session));
      return this.diffuserSession(m.session.id);
    }
    if (m.kind === 'historique') {
      this.historique(machine, sessionId, m.replay, m.evenements);
      return;
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
    this.decouvertesDuPoste.set(machine, m.decouvertes ?? []);
    this.infos.set(machine, {
      commit: m.commit ?? null,
      empreinte: m.empreinte ?? null,
      claudeCode: m.claudeCode ?? null,
    });
    for (const s of m.sessions) {
      if (s.machine !== machine || !this.appartient(s.id, machine)) continue;
      this.registre.enregistrerSession(this.avecJumelle(s));
      this.diffuserSession(s.id);
    }
    this.fermerNonAnnoncees(machine, new Set(m.sessions.map((s) => s.id)));
    this.diffuserMachine(machine);
    this.miseAJour?.(machine, m.empreinte);
  }

  // Une session que le poste n'annonce plus n'a plus de processus qu'il suit : elle est fermée, pas laissée « en
  // attente » pour toujours.
  private fermerNonAnnoncees(machine: string, annoncees: ReadonlySet<string>): void {
    for (const s of this.registre.sessions(true)) {
      if (s.machine !== machine || s.statut === 'fermee' || annoncees.has(s.id)) continue;
      this.journal.info({ machine, sessionId: s.id, statut: s.statut }, 'session absente de l’annonce : fermée');
      this.registre.enregistrerSession({ ...s, statut: 'fermee' });
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

  // Relecture du transcript d'une session découverte, adoptée ou suivie hors de Lanterne : un lot ne s'ajoute au fil
  // que s'il contient sa suite (voir fusion-historique.ts). Sur un fil vide, tout s'écrit ; sur un fil rempli, seule la
  // suite du dernier événement connu part, en diffusion. Ce sont des événements anciens : aucune notification.
  private historique(machine: string, sessionId: string, replay: string, lot: readonly EvenementHorodate[]): void {
    const { etat, ajout } = avancerRelecture(
      this.relectures.get(sessionId),
      replay,
      () => this.ancreDuFil(sessionId),
      lot,
    );
    this.relectures.set(sessionId, etat);
    if (ajout.length === 0) {
      this.journal.debug({ sessionId, lot: lot.length }, 'relecture : rien à ajouter au fil');
      if (queueSansAncre(etat.ancre, lot) && !this.relecturesCompletesDemandees.has(sessionId)) {
        this.relecturesCompletesDemandees.add(sessionId);
        this.journal.info({ sessionId }, 'relecture : ancre du fil absente de la queue, relecture complète demandée');
        this.envoyer(machine, { kind: 'historique', sessionId });
      }
      return;
    }
    const ajoutes = this.registre.ajouterSuite(sessionId, ajout);
    if (etat.fusion) for (const evenement of ajoutes) this.diffusion.diffuser({ type: 'evenement', evenement });
    this.diffuserSession(sessionId);
    this.journal.info(
      { sessionId, ajoutes: ajout.length, fusion: etat.fusion },
      'historique relu : suite ajoutée au fil',
    );
  }

  // Session Remote Control (claude.ai) qui est la même conversation qu'une session de poste (Desktop sur la tour) :
  // les deux fils partagent les uuid des lignes du transcript. Sa `conversation` devient celle du poste, ce qui la
  // rattache à sa jumelle dans la liste. Recherche gardée en cache ; un échec est retenté au plus une fois par minute.
  private avecJumelle(s: ResumeSession): ResumeSession {
    if (!s.distant || !s.id.startsWith('cse_')) return s;
    const connu = this.jumelles.get(s.id);
    let jumelle = connu?.jumelle ?? null;
    if (!jumelle && (!connu || Date.now() - connu.essai > ESSAI_JUMELLE_MS)) {
      const uuids = this.registre
        .derniersEvenements(s.id, 200)
        .map((e) => {
          const evt = e.evt as { type: string; uuid?: unknown; id?: unknown };
          return evt.type === 'outil' ? evt.id : evt.uuid;
        })
        .filter((u): u is string => typeof u === 'string' && u !== '');
      jumelle = this.registre.sessionPartageantUuid(uuids, s.id);
      this.jumelles.set(s.id, { jumelle, essai: Date.now() });
    }
    const fiche = jumelle ? this.registre.session(jumelle) : null;
    if (!fiche) return s;
    return { ...s, distant: { ...s.distant, conversation: fiche.claudeSessionId ?? fiche.id } };
  }

  private ancreDuFil(sessionId: string): string | null {
    const dernier = this.registre.derniersEvenements(sessionId, 1)[0];
    return dernier ? cleEvenement(dernier) : null;
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
