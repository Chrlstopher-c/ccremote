// Responsabilité : les sessions Claude du poste — découverte dans tmux, ouverture, commandes du relais, crochets,
// persistance.
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { UsageSdk } from '../../commun/compte-detail.ts';
import type { LimiteSdk } from '../../commun/comptes.ts';
import type { DemandeSession, ResumeSession } from '../../commun/session.ts';
import type { ConfigPoste } from '../config.ts';
import { basculerControle, sortirTui } from './bascule-controle.ts';
import type { CommandeSession } from './lecture-panneau.ts';
import {
  type ContexteCommandes,
  executerSurSession,
  fichierPresente,
  fichiersDeSession,
  historiqueRejoue,
  reponseAdoption,
} from './commandes-session.ts';
import { PersistanceSessions, type SessionPersistee } from './persistance.ts';
import {
  type ReprisePrevue,
  conversationsTenuesAilleurs,
  relancerApresRedemarrage,
  reprisePrevue,
} from './reprise.ts';
import { SessionTmux } from './session-tmux.ts';
import { annexer, dupliquer } from './copie.ts';
import { ControlesDifferes } from './controle-differe.ts';
import { stylesDeSessionId } from './styles-session.ts';
import { SessionSdk, trouverClaude } from './session-sdk.ts';
import type { SessionPoste, SortieSession } from './session-poste.ts';
import { titreRelu } from './recalage-fiche.ts';
import { MarquesRecalage, RecalageFils, recalerAuChargement } from './recalage-demarrage.ts';
import { stockeurImages } from './historique.ts';
import { fichePourIdentifiant } from './identifiants-fiche.ts';
import { dossierRegistreCc, lireRegistreCc } from './registre-cc.ts';
import { IndexDecouvertes, type TranscriptDecouvert, identifiantsTranscripts } from './decouverte.ts';
import { ImportationSessions } from './importation-sessions.ts';
import { ouvrirSession } from './ouverture-session.ts';
import type { Decouverte, FicheDesktopAnnoncee } from '../../commun/decouverte.ts';
import { RACINE_DESKTOP_DEFAUT, fichesDesktopAnnoncees } from './fiche-desktop.ts';
import {
  SessionsSupprimees,
  supprimerNonSuivie,
  supprimerTranscript,
  transcriptsDeLaSession,
} from './suppression.ts';
import { estCommandeArtefact, executerArtefacts } from '../presentation/commande-artefacts.ts';
import { estCommandeModifications, ModificationsSessions } from '../modifications/commande-modifications.ts';
import { estFichiersSession } from '../fichiers/session.ts';
import { Stockage } from '../presentation/stockage.ts';
import type { RequeteRelais } from '../presentation/outils.ts';
import { UsageComptes } from './usage-compte.ts';
import { Spectateur } from '../distant/spectateur.ts';
import { BalayageSessions } from './balayage-sessions.ts';
import { TraceRelais, avecTraceRelais } from '../relais-sessions/trace.ts';

export interface Reponse {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}

const PERIODE_DECOUVERTE_MS = 2_000;
const PERIODE_LECTURE_MS = 700;
export { moteurDe } from './fiche-initiale.ts';

export class GestionnaireSessions {
  readonly sessions = new Map<string, SessionPoste>();
  private readonly persistance: PersistanceSessions;
  private readonly supprimees: SessionsSupprimees;
  private readonly stockage: Stockage;
  private readonly modifications: ModificationsSessions;
  private sauvegardePrevue: ReturnType<typeof setTimeout> | null = null;
  private readonly controles = new ControlesDifferes();
  private readonly decouvertes: IndexDecouvertes;
  private readonly importation: ImportationSessions;
  private readonly usages: UsageComptes;
  // Sessions Remote Control des comptes suivis, lues sur claude.ai : jamais persistées, jamais dans `sessions`.
  private readonly distantes: Spectateur;
  private readonly trace: TraceRelais;
  private readonly balayage: BalayageSessions;
  private readonly marques: MarquesRecalage;
  private readonly recalage: RecalageFils;
  /** Lien au relais ouvert : posé par le poste (bin.ts) ; le recalage des fils n'avance que lien ouvert. */
  relaisOuvert: () => boolean = () => false;
  /** Lien au relais pour les outils de modules des sessions SDK : posé par bin.ts. */
  requeteRelais: RequeteRelais = () => Promise.resolve({ ok: false, erreur: 'lien au relais non branché' });
  private readonly sortieFil: SortieSession; // la sortie, dont l'historique repasse par la trace de relais
  // Parent d'une copie dupliquée avant que son transcript soit découvert : posé à sa création (voir creer).
  private readonly parentsAttendus = new Map<string, string>();

  constructor(
    readonly config: ConfigPoste,
    private readonly sortie: SortieSession,
    private readonly socket: string,
    readonly journal: Logger,
  ) {
    this.persistance = new PersistanceSessions(config.donnees);
    this.supprimees = new SessionsSupprimees(config.donnees);
    this.stockage = new Stockage(config.donnees);
    this.decouvertes = this.creerDecouvertes();
    this.usages = new UsageComptes(() => this.sessions.values(), journal);
    this.trace = new TraceRelais(config.donnees, journal);
    this.sortieFil = avecTraceRelais(sortie, this.trace);
    this.distantes = this.creerDistantes();
    this.modifications = new ModificationsSessions({
      donnees: config.donnees,
      machine: config.machine,
      journal,
      sortie,
    });
    this.importation = this.creerImportation();
    this.balayage = this.creerBalayage();
    this.marques = new MarquesRecalage(join(config.donnees, 'recalage.json'), journal);
    this.recalage = this.creerRecalage();
  }

  private creerDecouvertes(): IndexDecouvertes {
    return new IndexDecouvertes({
      machine: this.config.machine,
      configDirs: () => this.configDirs(),
      fichierCache: join(this.config.donnees, 'decouvertes.json'),
      journal: this.journal,
      surChangement: () => this.annoncer(),
    });
  }

  private creerDistantes(): Spectateur {
    return new Spectateur({
      config: this.config,
      journal: this.journal,
      sortie: this.sortieFil,
      locales: () => [...this.sessions.values()].map((s) => s.resume),
      stockage: this.stockage,
    });
  }

  private creerImportation(): ImportationSessions {
    return new ImportationSessions({
      config: this.config,
      journal: this.journal,
      decouvertes: this.decouvertes,
      sessions: this.sessions,
      supprimees: this.supprimees,
      creer: (p) => this.creer(p),
      configDirs: () => this.configDirs(),
      annoncer: () => this.annoncer(),
      sauvegarder: () => this.sauvegarder(),
      publier: (r) => this.sortie.resume(r),
    });
  }

  private creerBalayage(): BalayageSessions {
    return new BalayageSessions({
      config: this.config,
      journal: this.journal,
      sessions: this.sessions,
      supprimees: this.supprimees,
      fichePour: (id) => this.fichePour(id),
      creer: (p) => this.creer(p),
    });
  }

  private creerRecalage(): RecalageFils {
    return new RecalageFils({
      ...{ journal: this.journal, marques: this.marques, relaisOuvert: () => this.relaisOuvert() },
      fiches: () => [...this.sessions.values()].map((s) => ({ persistee: s.persistee, vivante: s.vivante })),
      stockeur: (id) => stockeurImages(this.stockage, id, this.journal),
      recalage: (id, archiver, lignes) => this.sortie.recalage?.(id, archiver, lignes),
      historique: (id, evenements) => this.sortieFil.historique?.(id, evenements),
    });
  }

  /** Lien au relais (r)ouvert : les fils des sessions dont le transcript a changé depuis leur recalage sont relus. */
  recalerFils = (): void => this.recalage.lancer();

  demarrer(): void {
    const persistees = this.persistance
      .charger()
      .map((p) => recalerAuChargement(titreRelu(p, this.journal), this.marques, { journal: this.journal }));
    for (const p of persistees) this.sessions.set(p.resume.id, this.creer(p));
    setTimeout(() => this.decouvertes.demarrer(), 0); // premier index lourd : après le démarrage du poste
    void relancerApresRedemarrage(this.reprisesPrevues(persistees), this.journal);
    void this.decouvrir();
    setInterval(() => void this.decouvrir(), PERIODE_DECOUVERTE_MS);
    setInterval(() => this.lireTout(), PERIODE_LECTURE_MS);
    this.distantes.demarrer();
  }

  lister(): ResumeSession[] {
    return [...this.sessions.values()].map((s) => s.resume).concat(this.distantes.lister());
  }

  /** Bascule la lecture des sessions Remote Control d'un compte (interrupteur des Paramètres > Comptes). */
  basculerDistant(nom: string, actif: boolean): Reponse {
    return this.distantes.basculer(nom, actif);
  }

  // Message relayé entre deux sessions : tracé sur le poste (daté), puis émis en direct dans le fil de la session.
  private tracer(c: Extract<CommandeSession, { kind: 'tracer_relais' }>): Reponse {
    if (!this.sessions.has(c.sessionId) && !this.distantes.session(c.sessionId)) {
      return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    }
    const evt = this.trace.tracer(c.sessionId, c);
    if (!evt) return { ok: false, erreur: 'trace de relais impossible à écrire' };
    this.sortie.evenement(c.sessionId, evt.evt);
    return { ok: true };
  }

  session(id: string): SessionPoste | undefined {
    return this.sessions.get(id);
  }

  // Session à agir : sa fiche si elle est tenue ici, sinon une session découverte ou fermée du poste, adoptée (fiche
  // fermée, reprenable par le SDK). Un identifiant inconnu partout rend `undefined`.
  async hydrater(id: string): Promise<SessionPoste | undefined> {
    const connue = this.sessions.get(id);
    if (connue) return connue;
    const distante = this.distantes.session(id);
    if (distante) return distante;
    const decouverte = this.trouverImportables().find((t) => t.id === id);
    if (decouverte) {
      this.importerUne(decouverte);
      this.annoncer();
      this.sauvegarder();
      this.recalage.lancer(); // fil complet relu (la reprise d'adoption n'envoie que la queue)
      return this.sessions.get(id);
    }
    if (this.supprimees.has(id)) return undefined;
    const entree = lireRegistreCc(dossierRegistreCc(), this.journal).find((e) => e.id === id);
    if (!entree) return undefined;
    this.balayage.ajouterFermee(entree);
    this.sauvegarder();
    return this.sessions.get(id);
  }

  // Un compte ne se retire pas sous une session vivante : pane tmux ou requête SDK ouverte.
  enUsage(compte: string): boolean {
    return [...this.sessions.values()].some((s) => s.resume.compte === compte && s.vivante);
  }

  /** Usage SDK d'un compte (abonnement, contributeurs) : lu sur une session vivante du compte, gardé 5 min. */
  /** Fenêtre de quota vue dans le flux SDK d'une session d'un compte (posée par le poste, relayée au relais). */
  surLimite: ((compte: string, limite: LimiteSdk) => void) | null = null;

  usageCompte(compte: string): Promise<UsageSdk | null> {
    return this.usages.lire(compte);
  }

  ouvrir(d: DemandeSession): Promise<Reponse> {
    const controle = (id: string): void => this.controles.ajouter(id);
    return ouvrirSession({ config: this.config, sessions: this.sessions, creer: (p) => this.creer(p), controle }, d);
  }

  async executer(c: CommandeSession): Promise<Reponse> {
    await this.hydrater(c.sessionId);
    if (c.kind === 'adopter') return reponseAdoption(this.contexteCommandes(), c.sessionId);
    if (c.kind === 'historique' && this.distantes.session(c.sessionId)) return this.distantes.rejouer(c.sessionId);
    if (c.kind === 'tracer_relais') return this.tracer(c);
    if (c.kind === 'historique') return historiqueRejoue(this.contexteCommandes(), c.sessionId);
    if (c.kind === 'supprimer') return this.supprimer(c.sessionId);
    if (c.kind === 'dupliquer') return dupliquer(this, c.sessionId, c.messageId);
    if (c.kind === 'annexer') return annexer(this, c.sessionId);
    if (c.kind === 'styles') return stylesDeSessionId(this.sessions, c.sessionId, this.config.machine, this.journal);
    if (c.kind === 'fichier_session') return fichierPresente(this.contexteCommandes(), c.sessionId, c.fichier);
    if (estCommandeArtefact(c)) return executerArtefacts(this.stockage, c, this.journal);
    if (estFichiersSession(c)) return fichiersDeSession(this.contexteCommandes(), c);
    if (estCommandeModifications(c)) return this.modifications.executer(c, this.sessions.get(c.sessionId));
    if (c.kind === 'remote_control') return basculerControle(this, c.sessionId, c.actif);
    const s = this.sessions.get(c.sessionId) ?? this.distantes.session(c.sessionId);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    return executerSurSession(this.contexteCommandes(), s, c);
  }

  private contexteCommandes(): ContexteCommandes {
    return {
      gestion: this,
      stockage: this.stockage,
      journal: this.journal,
      refusDistant: (c) => this.distantes.refusPour(c.sessionId, c),
      configDirs: () => this.configDirs(),
    };
  }

  // Suppression sur demande explicite de Chris : la session s'arrête (SDK), son transcript part, son identifiant est
  // retenu pour qu'aucune découverte ne la fasse réapparaître. Une session ouverte dans un terminal reste intacte.
  async supprimer(id: string): Promise<Reponse> {
    if (this.distantes.session(id)) return { ok: false, erreur: 'session claude.ai : elle se gère depuis claude.ai' };
    const s = this.sessions.get(id);
    if (!s) return this.supprimerNonSuivie(id);
    if (s instanceof SessionSdk && s.vivante) {
      const erreur = await s.fermer();
      if (erreur) return { ok: false, erreur };
    }
    if (s instanceof SessionTmux && s.vivante && s.resume.pilotee && !s.resume.terminal) {
      const erreur = await sortirTui(s);
      if (erreur) return { ok: false, erreur };
    }
    if (s.vivante || s.resume.terminal) {
      return { ok: false, erreur: 'session ouverte dans un terminal : la fermer avant de la supprimer' };
    }
    try {
      for (const chemin of transcriptsDeLaSession(id, this.configDirs())) supprimerTranscript(chemin, id, this.journal);
      this.supprimees.ajouter(id);
    } catch (erreur) {
      this.journal.error({ err: erreur, session: id }, 'suppression impossible');
      return { ok: false, erreur: `suppression impossible : ${String(erreur)}` };
    }
    if (s instanceof SessionSdk) s.liberer();
    this.sessions.delete(id);
    this.modifications.oublier(id);
    this.supprimerFichiers(id);
    this.sauvegarder();
    return { ok: true };
  }

  // Les fichiers présentés par la session partent avec elle ; un échec est journalisé, la suppression tient.
  // Fiche que le poste ne suit plus (fantôme du relais) : supprimable aussi, sauf si un processus la tient encore.
  private supprimerNonSuivie(id: string): Reponse {
    const tenues = conversationsTenuesAilleurs(Object.values(this.config.comptes), this.journal);
    try {
      const r = supprimerNonSuivie(id, this.configDirs(), tenues, this.journal);
      if (!r.ok) return r;
    } catch (erreur) {
      this.journal.error({ err: erreur, session: id }, 'suppression impossible');
      return { ok: false, erreur: `suppression impossible : ${String(erreur)}` };
    }
    this.supprimees.ajouter(id);
    this.modifications.oublier(id);
    this.supprimerFichiers(id);
    return { ok: true, donnees: null };
  }

  private supprimerFichiers(id: string): void {
    try {
      this.stockage.supprimer(id);
    } catch (erreur) {
      this.journal.error({ err: erreur, session: id }, 'fichiers présentés non supprimés');
    }
  }

  // Sessions Claude Code du poste que Quart ne connaît pas encore (ni supprimées par Chris).
  importables(): Reponse {
    return { ok: true, donnees: this.listeDecouvertes() };
  }

  listeDecouvertes(): Decouverte[] {
    return this.importation.listeDecouvertes();
  }

  importer(ids: readonly string[]): Reponse {
    return { ok: true, donnees: this.importation.importer(ids) };
  }

  trouverImportables(): TranscriptDecouvert[] {
    return this.importation.trouverImportables();
  }

  importerUne(t: TranscriptDecouvert, surcharge: Partial<ResumeSession> = {}, consignes: string | null = null): void {
    this.importation.importerUne(t, surcharge, consignes);
  }

  // Annonce au relais : sessions découvertes et identifiants de tous les transcripts du poste (fantômes).
  annoncer(): void {
    this.sortie.decouvertes?.(this.listeDecouvertes(), this.transcriptsConnus(), this.fichesDesktop());
  }

  fichesDesktop(): FicheDesktopAnnoncee[] {
    return fichesDesktopAnnoncees(RACINE_DESKTOP_DEFAUT, this.journal);
  }

  transcriptsConnus(): string[] {
    return identifiantsTranscripts(this.configDirs());
  }

  // La fiche d'un identifiant : sa clé, son identifiant courant ou un identifiant SDK passé (rembobinage). Jamais une
  // nouvelle fiche.
  private fichePour(id: string): SessionPoste | undefined {
    return fichePourIdentifiant(this.sessions.values(), id);
  }

  // Copie dupliquée pas encore découverte : fiche déjà ouverte → parent posé ici ; sinon il attend l'import.
  attendreParent(idCopie: string, idParent: string): void {
    const ouverte = this.sessions.get(idCopie);
    if (!ouverte) {
      this.parentsAttendus.set(idCopie, idParent);
      return;
    }
    ouverte.resume.parent = idParent;
    this.sortie.resume(ouverte.resume);
  }

  // Configurations de comptes connues, plus la configuration par défaut de Claude Code.
  private configDirs(): (string | null)[] {
    return [null, ...Object.values(this.config.comptes)];
  }

  // Arrêt du poste : chaque processus SDK s'arrête ; les sessions tmux ne sont pas touchées.
  arreterProcessus(): void {
    for (const s of this.sessions.values()) if (s instanceof SessionSdk) s.arreterProcessus();
  }

  sauvegarder(): void {
    try {
      this.persistance.ecrire([...this.sessions.values()].map((s) => s.persistee));
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'écriture des sessions impossible');
    }
  }

  // Une conversation tenue par un processus Claude vivant hors du poste (Desktop, terminal) n'est jamais reprise : la
  // relancer ferait deux processus sur le même transcript, et le fil de l'autre ne serait plus suivi.
  private reprisesPrevues(persistees: readonly SessionPersistee[]): ReprisePrevue[] {
    const tenues = conversationsTenuesAilleurs(Object.values(this.config.comptes), this.journal);
    return persistees.flatMap((p) => {
      const prevue = reprisePrevue(p);
      const session = this.sessions.get(p.resume.id);
      if (!prevue || !(session instanceof SessionSdk)) return [];
      if (tenues.has(p.resume.claudeSessionId ?? p.resume.id) || tenues.has(p.resume.id)) {
        this.journal.info({ session: p.resume.id }, 'conversation tenue ailleurs : pas de reprise au démarrage');
        session.renoncerReprise();
        return [];
      }
      return [{ session, texte: prevue.texte }];
    });
  }

  // Point unique de création de fiche : une copie attendue reçoit son parent ici, quel que soit le chemin d'import.
  private avecParentAttendu(p: SessionPersistee): SessionPersistee {
    const parent = this.parentsAttendus.get(p.resume.id);
    if (parent === undefined) return p;
    this.parentsAttendus.delete(p.resume.id);
    return p.resume.parent ? p : { ...p, resume: { ...p.resume, parent } };
  }

  creer(recue: SessionPersistee): SessionPoste {
    const p = this.avecParentAttendu(recue);
    const sortie: SortieSession = {
      evenement: (id, evt) => this.sortie.evenement(id, evt),
      historique: (id, evts, direct) => this.sortieFil.historique?.(id, evts, direct),
      resume: (r) => {
        this.sortie.resume(r);
        this.planifierSauvegarde();
      },
    };
    // Une session fermée se reprend par le SDK, qu'elle ait été ouverte par le TUI ou non.
    if (p.resume.moteur === 'sdk' || p.resume.statut === 'fermee') {
      const relais: RequeteRelais = (quoi, args) => this.requeteRelais(quoi, args);
      const presentation = { stockage: this.stockage, racines: this.config.racines, api: this.config.api, relais };
      const tours = this.modifications.toursDe(p.resume.id, p.resume.cwd);
      const limite = (l: LimiteSdk): void => {
        if (p.resume.compte !== null) this.surLimite?.(p.resume.compte, l);
      };
      const env = { journal: this.journal, sortie, executable: trouverClaude(), socket: this.socket, limite };
      return new SessionSdk(p, { ...env, presentation, tours });
    }
    return new SessionTmux(p, { socket: this.socket, journal: this.journal, sortie });
  }

  private planifierSauvegarde(): void {
    if (this.sauvegardePrevue) return;
    this.sauvegardePrevue = setTimeout(() => {
      this.sauvegardePrevue = null;
      this.sauvegarder();
    }, 2_000);
  }

  private async decouvrir(): Promise<void> {
    await this.balayage.rafraichir();
    await Promise.all([...this.sessions.values()].map((s) => s.releverEcran()));
    await Promise.all([...this.sessions.values()].map((s) => s.veillerNuit()));
    void this.controles.traiter(this);
  }

  private lireTout(): void {
    for (const s of this.sessions.values()) {
      try {
        s.lire();
      } catch (erreur) {
        this.journal.warn({ session: s.resume.id, err: erreur }, 'lecture du transcript en échec');
      }
    }
  }
}

