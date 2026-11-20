// Responsabilité : les postes connectés au relais — authentification, comptes rendus reçus, commandes envoyées.
// Un poste rend compte de SES sessions et n'a aucun moyen de commander quoi que ce soit.
import type { ServerWebSocket } from 'bun';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import { type CommandeRelais, ENTETE_MACHINE, MessagePoste } from '../../commun/protocole-poste.ts';
import type { Decouverte, FicheDesktopAnnoncee } from '../../commun/decouverte.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { LimiteSdk } from '../../commun/comptes.ts';
import type { AccesVue, EvenementDate, VueInstallation, VueMachine } from '../../commun/api-clients.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import { notificationPour } from '../notifications/regles.ts';
import { decouverteParIdentifiant } from './decouvertes-postes.ts';
import { fantomesARetirer } from './fantomes.ts';
import { DesktopDesPostes } from './desktop-postes.ts';
import { ArchivagesEnMemoire } from '../registre/archivages-desktop.ts';
import { avecDecouverteJumelle, avecJumelleReelle } from './jumelle-distante.ts';
import type { Registre } from '../registre/registre.ts';
import type { LignesTranscript } from '../registre/nettoyage-fil.ts';
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
  // Identifiants de tous les transcripts de chaque poste : une fiche dont la conversation n'existe nulle part est fantôme.
  private readonly transcriptsDuPoste = new Map<string, ReadonlySet<string>>();
  private readonly infos = new Map<string, InfosPoste>();
  /** Fiches Claude Desktop des postes : Remote Control et archivage (base : ArchivagesDesktop, posé par bin.ts). */
  desktop = new DesktopDesPostes(new ArchivagesEnMemoire());
  // Session → où en est la relecture de son transcript (voir fusion-historique.ts).
  private readonly relectures = new Map<string, EtatRelecture>();
  // Session Remote Control → session de poste qui tient la même conversation (voir avecJumelle).
  private readonly jumelles = new Map<string, { jumelle: string | null; essai: number }>();
  // Sessions dont une relecture complète a été demandée au poste (queue sans l'ancre du fil) : une fois par session.
  private readonly relecturesCompletesDemandees = new Set<string>();
  // Relecture complète demandée et pas encore reçue : son premier lot la consomme (fusion chronologique).
  private readonly completesAttendues = new Set<string>();
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
    this.transcriptsDuPoste.delete(ws.data.machine);
    this.desktop.oublier(ws.data.machine);
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
    if (m.kind === 'decouvertes') return this.recevoirDecouvertes(machine, m.decouvertes, m.transcripts, m.desktop);
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
      this.registre.enregistrerSession(this.desktop.avecDesktop(this.avecJumelle(m.session)));
      return this.diffuserSession(m.session.id);
    }
    if (m.kind === 'historique') {
      this.historique(machine, sessionId, m.replay, m.evenements);
      return;
    }
    if (m.kind === 'recalage') {
      const transcript =
        m.lignes && m.jusqua
          ? { cles: new Set(m.lignes), messages: new Set(m.messages ?? []), jusqua: m.jusqua }
          : undefined;
      return this.recaler(sessionId, m.archiver, transcript);
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
    this.recevoirDecouvertes(machine, m.decouvertes ?? [], m.transcripts, m.desktop);
    this.infos.set(machine, {
      commit: m.commit ?? null,
      empreinte: m.empreinte ?? null,
      claudeCode: m.claudeCode ?? null,
    });
    for (const s of m.sessions) {
      if (s.machine !== machine || !this.appartient(s.id, machine)) continue;
      this.registre.enregistrerSession(this.desktop.avecDesktop(this.avecJumelle(s)));
      this.diffuserSession(s.id);
    }
    this.fermerNonAnnoncees(machine, new Set(m.sessions.map((s) => s.id)));
    this.adopterOrphelines(machine, new Set(m.sessions.map((s) => s.id)), m.transcripts);
    this.retirerFantomes();
    this.diffuserMachine(machine);
    this.miseAJour?.(machine, m.empreinte);
  }

  private recevoirDecouvertes(
    machine: string,
    decouvertes: readonly Decouverte[],
    transcripts?: readonly string[],
    desktop?: readonly FicheDesktopAnnoncee[],
  ): void {
    this.decouvertesDuPoste.set(machine, decouvertes);
    if (transcripts) this.transcriptsDuPoste.set(machine, new Set(transcripts));
    this.desktop.recevoir(machine, desktop);
    this.retirerFantomes();
    if (desktop) this.appliquerDesktop();
  }

  // Fiches Desktop reçues : Remote Control reporté sur la fiche de la conversation, archivage repris une fois.
  private appliquerDesktop(): void {
    for (const s of this.registre.sessions(false)) {
      const conversation = s.claudeSessionId ?? s.id;
      if (this.desktop.aArchiver(conversation)) {
        this.desktop.archivee(conversation);
        this.journal.info({ sessionId: s.id }, 'archivée dans Claude Desktop : rangée');
        this.registre.definirArchivee(s.id, true);
        this.diffuserSession(s.id);
        continue;
      }
      const recalee = this.desktop.avecDesktop(s);
      if (recalee === s) continue;
      this.registre.enregistrerSession(recalee);
      this.diffuserSession(s.id);
    }
  }

  // Fiche que son poste n'annonce plus alors que sa conversation existe sur ce poste : le poste l'adopte (fiche recalée
  // sur le transcript, fil relu), comme à l'ouverture d'une découverte.
  private adopterOrphelines(machine: string, annoncees: ReadonlySet<string>, transcripts?: readonly string[]): void {
    if (!transcripts) return;
    const existants = new Set(transcripts);
    for (const s of this.registre.sessions(false)) {
      if (s.machine !== machine || annoncees.has(s.id) || s.distant || s.annexe_de) continue;
      if (!existants.has(s.claudeSessionId ?? s.id)) continue;
      this.journal.info({ machine, sessionId: s.id }, 'fiche orpheline : adoptée par son poste');
      void this.commander(machine, { kind: 'adopter', sessionId: s.id });
    }
  }

  // Une fiche fermée dont la conversation n'existe sur aucun poste en ligne est masquée (archivée), jamais supprimée.
  private retirerFantomes(): void {
    if (this.transcriptsDuPoste.size === 0) return; // aucun poste n'a encore annoncé ses transcripts
    const fiches = this.registre.sessions(false).map((s) => ({
      id: s.id,
      machine: s.machine,
      conversation: s.claudeSessionId ?? null,
      statut: s.statut,
      archivee: false,
    }));
    for (const id of fantomesARetirer(fiches, this.transcriptsDuPoste, new Set(this.connectes.keys()))) {
      this.journal.info({ sessionId: id }, 'fiche sans transcript sur aucun poste en ligne : masquée');
      this.registre.definirArchivee(id, true);
      this.diffuserSession(id);
    }
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
  // que s'il contient sa suite (voir fusion-historique.ts), sans doublon. Une relecture complète demandée par le relais
  // (queue sans l'ancre) comble les trous, chaque événement à sa place chronologique. Ce sont des événements anciens :
  // aucune notification.
  private historique(machine: string, sessionId: string, replay: string, lot: readonly EvenementHorodate[]): void {
    const precedent = this.relectures.get(sessionId);
    const premier = precedent?.replay !== replay;
    const complet = premier ? this.completesAttendues.delete(sessionId) : precedent?.complet === true;
    if (complet) return this.historiqueComplet(sessionId, replay, lot, premier);
    const { etat, ajout } = avancerRelecture(precedent, replay, () => this.ancreDuFil(sessionId), lot);
    this.relectures.set(sessionId, etat);
    if (ajout.length === 0) {
      this.journal.debug({ sessionId, lot: lot.length }, 'relecture : rien à ajouter au fil');
      const desaccorde = queueSansAncre(etat.ancre, lot) || !this.registre.lotRaccorde(sessionId, lot);
      if (desaccorde && !this.relecturesCompletesDemandees.has(sessionId)) {
        this.relecturesCompletesDemandees.add(sessionId);
        this.completesAttendues.add(sessionId);
        this.journal.info({ sessionId }, 'relecture : ancre du fil absente de la queue, relecture complète demandée');
        this.envoyer(machine, { kind: 'historique', sessionId });
      }
      return;
    }
    const fusion = this.registre.fusionnerHistorique(sessionId, ajout, { complet: false, premier: false });
    if (etat.fusion && !fusion.reecrit) for (const evenement of fusion.ajoutes) this.diffuserFil(evenement);
    this.diffuserSession(sessionId);
    this.journal.info(
      { sessionId, ajoutes: fusion.ajoutes.length, reecrit: fusion.reecrit, fusion: etat.fusion },
      'historique relu : suite ajoutée au fil',
    );
  }

  private historiqueComplet(
    sessionId: string,
    replay: string,
    lot: readonly EvenementHorodate[],
    premier: boolean,
  ): void {
    this.relectures.set(sessionId, { replay, ancre: null, fusion: true, complet: true });
    const fusion = this.registre.fusionnerHistorique(sessionId, lot, { complet: true, premier });
    if (!fusion.reecrit) for (const evenement of fusion.ajoutes) this.diffuserFil(evenement);
    this.diffuserSession(sessionId);
    this.journal.info(
      {
        sessionId,
        lot: lot.length,
        ajoutes: fusion.ajoutes.length,
        reecrit: fusion.reecrit,
        remplace: fusion.remplace,
      },
      'relecture complète : fil comblé',
    );
  }

  // Recalage d'une session par son poste : fil nettoyé, archivage Desktop appliqué (une fois) ; la relecture qui suit
  // est complète.
  private recaler(sessionId: string, archiver: boolean, transcript?: LignesTranscript): void {
    const conversation = this.registre.session(sessionId)?.claudeSessionId ?? sessionId;
    if (archiver && !this.desktop.dejaArchivee(conversation)) {
      this.desktop.archivee(conversation);
      this.registre.definirArchivee(sessionId, true);
    }
    const retires = this.registre.nettoyerFil(sessionId, transcript);
    this.relectures.delete(sessionId);
    this.relecturesCompletesDemandees.add(sessionId);
    this.completesAttendues.add(sessionId);
    this.journal.info({ sessionId, retires, archiver }, 'recalage : fil nettoyé, relecture complète attendue');
    this.diffuserSession(sessionId);
  }

  private diffuserFil(evenement: EvenementDate): void {
    this.diffusion.diffuser({ type: 'evenement', evenement });
  }

  // Session Remote Control (claude.ai) qui est la même conversation qu'une session de poste (Desktop sur la tour) :
  // les deux fils partagent les uuid des lignes du transcript. Sa `conversation` devient celle du poste, ce qui la
  // rattache à sa jumelle dans la liste. Recherche gardée en cache ; un échec est retenté au plus une fois par minute.
  private avecJumelle(s: ResumeSession): ResumeSession {
    if (!s.distant || !s.id.startsWith('cse_')) return s;
    const parPont = this.decouverteDuPont(s.id);
    // Conversation déjà ouverte par un poste : sa fiche dit la vraie machine (le même transcript peut exister ailleurs).
    const ouverte = parPont ? this.registre.session(parPont.id) : null;
    if (ouverte && !ouverte.distant) return avecJumelleReelle(s, ouverte);
    if (parPont) return avecDecouverteJumelle(s, parPont);
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
    return avecJumelleReelle(s, jumelle ? this.registre.session(jumelle) : null);
  }

  // Conversation pas encore ouverte (découverte d'un poste en ligne) dont le transcript ou la fiche Desktop nomme
  // cette session Remote Control (lien exact, sans fil à comparer).
  private decouverteDuPont(id: string): Decouverte | null {
    const candidates = [...this.decouvertesDuPoste.entries()]
      .filter(([machine]) => this.enLigne(machine))
      .flatMap(([machine, liste]) => liste.map((decouverte) => ({ machine, decouverte })));
    return decouverteParIdentifiant(candidates).find((d) => d.ponts?.includes(id)) ?? null;
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
