// Responsabilité : les sessions Claude du poste — découverte dans tmux, ouverture, commandes du relais, crochets,
// persistance.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { UsageSdk } from '../../commun/compte-detail.ts';
import type { DemandeSession, ResumeSession } from '../../commun/session.ts';
import type { ConfigPoste } from '../config.ts';
import { composerConsignes } from './consignes.ts';
import { basculerControle, enBascule, rembobinerTui, sortirTui } from './bascule-controle.ts';
import { type CommandeSession, estLecture, lecturePanneau } from './lecture-panneau.ts';
import { PersistanceSessions, type SessionPersistee } from './persistance.ts';
import { type ReprisePrevue, relancerApresRedemarrage, reprisePrevue } from './reprise.ts';
import { SessionTmux } from './session-tmux.ts';
import { annexer, dupliquer } from './copie.ts';
import { ControlesDifferes } from './controle-differe.ts';
import { stylesDeSession } from './styles-session.ts';
import { reglagesDeOuverture } from './reglages-sdk.ts';
import { SessionSdk, trouverClaude } from './session-sdk.ts';
import type { SessionPoste, SortieSession } from './session-poste.ts';
import * as tmux from './tmux.ts';
import { processusClaude } from './processus.ts';
import { fichePourIdentifiant } from './identifiants-fiche.ts';
import { dossierRegistreCc, lireRegistreCc } from './registre-cc.ts';
import { cheminTranscript } from './transcript.ts';
import { ficheImportee } from './importation.ts';
import { IndexDecouvertes, type TranscriptDecouvert } from './decouverte.ts';
import type { Decouverte } from '../../commun/decouverte.ts';
import { SessionsSupprimees, supprimerTranscript, transcriptsDeLaSession } from './suppression.ts';
import { lireFichierSession } from '../presentation/lecture.ts';
import { estCommandeArtefact, executerArtefacts } from '../presentation/commande-artefacts.ts';
import { estCommandeModifications, ModificationsSessions } from '../modifications/commande-modifications.ts';
import { estFichiersSession, executerFichiersSession, type CommandeFichiersSession } from '../fichiers/session.ts';
import { Stockage } from '../presentation/stockage.ts';
import { titreDuTranscript } from './titre-transcript.ts';
import { modeleDuTranscript } from './modele-transcript.ts';
import { UsageComptes } from './usage-compte.ts';
import { Spectateur } from '../distant/spectateur.ts';
import { BalayageSessions, HISTORIQUE_ADOPTION, origineDe } from './balayage-sessions.ts';
import { repertoireDe, resumeInitial } from './fiche-initiale.ts';
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
  private readonly usages: UsageComptes;
  // Sessions Remote Control des comptes suivis, lues sur claude.ai : jamais persistées, jamais dans `sessions`.
  private readonly distantes: Spectateur;
  private readonly trace: TraceRelais;
  private readonly balayage: BalayageSessions;
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
    this.decouvertes = new IndexDecouvertes({
      machine: config.machine,
      configDirs: () => this.configDirs(),
      fichierCache: join(config.donnees, 'decouvertes.json'),
      journal,
      surChangement: () => this.sortie.decouvertes?.(this.listeDecouvertes()),
    });
    this.usages = new UsageComptes(() => this.sessions.values(), journal);
    this.trace = new TraceRelais(config.donnees, journal);
    this.sortieFil = avecTraceRelais(sortie, this.trace);
    this.distantes = new Spectateur({
      config,
      journal,
      sortie: this.sortieFil,
      locales: () => [...this.sessions.values()].map((s) => s.resume),
      stockage: this.stockage,
    });
    this.modifications = new ModificationsSessions({
      donnees: config.donnees,
      machine: config.machine,
      journal,
      sortie,
    });
    this.balayage = new BalayageSessions({
      config,
      journal,
      sessions: this.sessions,
      supprimees: this.supprimees,
      fichePour: (id) => this.fichePour(id),
      creer: (p) => this.creer(p),
    });
  }

  demarrer(): void {
    const persistees = this.persistance.charger().map((p) => this.titreRafraichi(p));
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

  // Session à agir : sa fiche si elle est tenue ici, sinon une session découverte ou fermée du poste, adoptée
  // (fiche fermée, reprenable par le SDK). Un identifiant inconnu partout rend `undefined`.
  async hydrater(id: string): Promise<SessionPoste | undefined> {
    const connue = this.sessions.get(id);
    if (connue) return connue;
    const distante = this.distantes.session(id);
    if (distante) return distante;
    const decouverte = this.trouverImportables().find((t) => t.id === id);
    if (decouverte) {
      this.importerUne(decouverte);
      this.sortie.decouvertes?.(this.listeDecouvertes());
      this.sauvegarder();
      return this.sessions.get(id);
    }
    if (this.supprimees.has(id)) return undefined;
    const entree = lireRegistreCc(dossierRegistreCc(), this.journal).find((e) => e.id === id);
    if (!entree) return undefined;
    this.balayage.ajouterFermee(entree);
    this.sauvegarder();
    return this.sessions.get(id);
  }

  // Historique d'une session dont le fil est vide au relais (fiche migrée, ou adoptée avant la relecture) : son
  // transcript repasse au relais. Une session en cours n'est pas relue : son fil vient du direct.
  private rejouerHistorique(id: string): Reponse {
    const s = this.sessions.get(id);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    if (!(s instanceof SessionSdk)) return { ok: false, erreur: 'historique relu seulement pour une session SDK' };
    if (s.vivante) return { ok: false, erreur: 'session en cours : historique non relu' };
    const conversation = s.resume.claudeSessionId;
    if (!conversation) return { ok: true, donnees: { evenements: 0 } };
    const chemin = cheminTranscript(s.resume.cwd, conversation, s.persistee.configDir);
    return { ok: true, donnees: { evenements: s.rejouerHistorique(chemin, true) } };
  }

  private reponseAdoption(id: string): Reponse {
    const s = this.sessions.get(id);
    return s ? { ok: true, donnees: s.resume } : { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
  }

  // Un compte ne se retire pas sous une session vivante : pane tmux ou requête SDK ouverte.
  enUsage(compte: string): boolean {
    return [...this.sessions.values()].some((s) => s.resume.compte === compte && s.vivante);
  }

  /** Usage SDK d'un compte (abonnement, contributeurs) : lu sur une session vivante du compte, gardé 5 min. */
  usageCompte(compte: string): Promise<UsageSdk | null> {
    return this.usages.lire(compte);
  }

  async ouvrir(d: DemandeSession): Promise<Reponse> {
    if (this.sessions.has(d.sessionId)) return { ok: false, erreur: 'session déjà ouverte' };
    const compte = d.compte ?? Object.keys(this.config.comptes)[0] ?? 'principal';
    if (!(compte in this.config.comptes))
      return { ok: false, erreur: `compte inconnu sur ${this.config.machine} : ${compte}` };
    const cwd = repertoireDe(this.config, d);
    if (!existsSync(cwd)) return { ok: false, erreur: `projet introuvable sur ${this.config.machine} : ${cwd}` };
    const configDir = this.config.comptes[compte] ?? null;
    const session = this.creer({
      resume: resumeInitial(this.config, d, cwd, compte),
      consignes: composerConsignes({
        machine: this.config.machine,
        cwd,
        demande: d,
        presentation: (d.moteur ?? 'sdk') === 'sdk',
      }),
      configDir,
      transcript: cheminTranscript(cwd, d.sessionId, configDir),
      position: 0,
      aReprendre: false,
    });
    this.sessions.set(d.sessionId, session);
    if (d.controle_distant) this.controles.ajouter(d.sessionId);
    const refusReglage = await reglagesDeOuverture(session, d);
    if (refusReglage) {
      this.sessions.delete(d.sessionId);
      return { ok: false, erreur: refusReglage };
    }
    const erreur = await session.lancer(d.message, d.modele ?? null, d.pieces ?? []);
    if (erreur) {
      this.sessions.delete(d.sessionId);
      return { ok: false, erreur };
    }
    return { ok: true, donnees: session.resume };
  }

  /** Panneau Fichiers d'une session : le dossier de la session borne tous les chemins. */
  private fichiersSession(c: CommandeFichiersSession): Promise<Reponse> {
    const s = this.sessions.get(c.sessionId);
    if (!s) return Promise.resolve({ ok: false, erreur: `session inconnue sur ${this.config.machine}` });
    return executerFichiersSession(c, s.resume.cwd, this.journal);
  }

  async executer(c: CommandeSession): Promise<Reponse> {
    await this.hydrater(c.sessionId);
    if (c.kind === 'adopter') return this.reponseAdoption(c.sessionId);
    if (c.kind === 'historique' && this.distantes.session(c.sessionId)) return this.distantes.rejouer(c.sessionId);
    if (c.kind === 'tracer_relais') return this.tracer(c);
    if (c.kind === 'historique') return this.rejouerHistorique(c.sessionId);
    if (c.kind === 'supprimer') return this.supprimer(c.sessionId);
    if (c.kind === 'dupliquer') return dupliquer(this, c.sessionId, c.messageId);
    if (c.kind === 'annexer') return annexer(this, c.sessionId);
    if (c.kind === 'styles') return this.styles(c.sessionId);
    if (c.kind === 'fichier_session') return this.fichier(c.sessionId, c.fichier);
    if (estCommandeArtefact(c)) return executerArtefacts(this.stockage, c, this.journal);
    if (estFichiersSession(c)) return this.fichiersSession(c);
    if (estCommandeModifications(c)) return this.modifications.executer(c, this.sessions.get(c.sessionId));
    if (c.kind === 'remote_control') return basculerControle(this, c.sessionId, c.actif);
    const s = this.sessions.get(c.sessionId) ?? this.distantes.session(c.sessionId);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    const refus = this.distantes.refusPour(c.sessionId, c);
    if (refus) return { ok: false, erreur: refus };
    if (enBascule(c.sessionId)) return { ok: false, erreur: 'bascule Remote Control en cours : réessayer' };
    if (estLecture(c)) return { ok: true, donnees: await lecturePanneau(s, c) };
    let erreur: string | null = null;
    if (c.kind === 'envoyer') erreur = await this.envoyerMessage(s, c.texte, c.pieces ?? []);
    else if (c.kind === 'interrompre') erreur = await s.interrompre();
    else if (c.kind === 'rembobiner') return this.rembobiner(s, c.messageId);
    else if (c.kind === 'compacter') erreur = await s.compacter();
    else if (c.kind === 'fermer') erreur = await s.fermer();
    else if (c.kind === 'reprendre') erreur = await s.reprendre();
    else if (c.kind === 'autonomie') s.basculerAutonomie(c.active);
    else if (c.kind === 'nuit') erreur = await s.basculerNuit(c.active, c.objectif);
    else if (c.kind === 'repondre') erreur = await s.repondre(c.reponse);
    else if (c.kind === 'arreter_tache')
      erreur = s instanceof SessionSdk ? await s.arreterTache(c.tache) : 'non pris en charge hors SDK';
    else if (c.kind === 'mode' || c.kind === 'modele' || c.kind === 'effort' || c.kind === 'renommer')
      erreur = await s.reglerSession(c);
    else if (c.kind === 'style') erreur = await s.reglerSession({ kind: 'style', style: c.style });
    else if (c.kind === 'rapide' || c.kind === 'ultracode') erreur = await s.reglerSession(c);
    else if (c.kind === 'connecteur')
      erreur = s instanceof SessionSdk ? await s.basculerConnecteur(c.nom, c.actif) : 'non pris en charge hors SDK';
    return erreur ? { ok: false, erreur } : { ok: true, donnees: s.resume };
  }

  private async styles(id: string): Promise<Reponse> {
    const s = this.sessions.get(id);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    return { ok: true, donnees: await stylesDeSession(s, this.journal) };
  }

  // Suppression sur demande explicite de Chris : la session s'arrête (SDK), son transcript part, son identifiant est
  // retenu pour qu'aucune découverte ne la fasse réapparaître. Une session ouverte dans un terminal reste intacte.
  // Rembobinage : une session SDK rembobine sur place ; une session du TUI repasse d'abord au SDK (voir bascule-controle).
  // Une session tmux qui n'a pas été lancée par le poste (adoptée d'un terminal de Chris) n'est pas touchée.
  private async rembobiner(s: SessionPoste, messageId: string): Promise<Reponse> {
    if (s instanceof SessionSdk) {
      const erreur = await s.rembobiner(messageId);
      return erreur ? { ok: false, erreur } : { ok: true, donnees: s.resume };
    }
    if (s instanceof SessionTmux && s.resume.pilotee) return rembobinerTui(this, s, messageId);
    return { ok: false, erreur: 'rembobinage impossible : session ouverte hors de l’appli (tmux de Chris)' };
  }

  async supprimer(id: string): Promise<Reponse> {
    if (this.distantes.session(id)) return { ok: false, erreur: 'session claude.ai : elle se gère depuis claude.ai' };
    const s = this.sessions.get(id);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
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
  private supprimerFichiers(id: string): void {
    try {
      this.stockage.supprimer(id);
    } catch (erreur) {
      this.journal.error({ err: erreur, session: id }, 'fichiers présentés non supprimés');
    }
  }

  // Fichier présenté, lu pour la route du relais : la session peut être fermée, le fichier reste sur le poste.
  private fichier(sessionId: string, fichier: string): Reponse {
    const lu = lireFichierSession(this.stockage, sessionId, fichier, this.journal);
    return lu ? { ok: true, donnees: lu } : { ok: false, erreur: 'fichier introuvable' };
  }

  // Les pièces jointes ne partent qu'avec une session SDK : le moteur tmux n'a pas de message structuré.
  private envoyerMessage(s: SessionPoste, texte: string, pieces: readonly PieceJointe[]): Promise<string | null> {
    if (pieces.length > 0 && !(s instanceof SessionSdk)) return Promise.resolve('pièces jointes : moteur SDK seulement');
    return s.envoyer(texte, pieces);
  }

  // Sessions Claude Code du poste que Quart ne connaît pas encore (ni supprimées par Chris).
  importables(): Reponse {
    return { ok: true, donnees: this.listeDecouvertes() };
  }

  // Sessions du poste (transcripts) pas encore ouvertes dans Lanterne, sans les identifiants supprimés par Chris.
  listeDecouvertes(): Decouverte[] {
    return this.decouvertes.liste((id) => this.fichePour(id) !== undefined || this.supprimees.has(id)).map(sansChemin);
  }

  // Ouverture des sessions découvertes choisies : fiches fermées, reprenables par le SDK ; l'historique vient du transcript.
  importer(ids: readonly string[]): Reponse {
    const trouves = this.trouverImportables();
    const aImporter = trouves.filter((t) => ids.includes(t.id));
    const absentes = ids.filter((id) => !aImporter.some((t) => t.id === id));
    for (const t of aImporter) this.importerUne(t);
    this.sauvegarder();
    this.sortie.decouvertes?.(this.listeDecouvertes());
    return { ok: true, donnees: { importees: aImporter.length, absentes } };
  }

  // Une session qui tourne en ce moment (processus Claude Code) n'est pas à importer : elle s'écrit encore.
  trouverImportables(): TranscriptDecouvert[] {
    const vivantes = new Set(processusClaude(this.configDirs(), this.journal).map((p) => p.sessionId));
    return this.decouvertes.liste((id) => this.fichePour(id) !== undefined || this.supprimees.has(id) || vivantes.has(id));
  }

  // La fiche d'un identifiant : sa clé, son identifiant courant ou un identifiant SDK passé (rembobinage). Jamais une nouvelle fiche.
  private fichePour(id: string): SessionPoste | undefined {
    return fichePourIdentifiant(this.sessions.values(), id);
  }

  importerUne(t: TranscriptDecouvert, surcharge: Partial<ResumeSession> = {}, consignes: string | null = null): void {
    const modele = modeleDuTranscript(t.chemin, this.journal);
    const session = this.creer({
      resume: { ...ficheImportee(origineDe(this.config), t), ...(modele ? { modele } : {}), ...surcharge },
      consignes,
      configDir: t.configDir,
      transcript: t.chemin,
      position: 0,
      aReprendre: false,
    });
    this.sessions.set(t.id, session);
    session.definirTranscript(t.chemin, HISTORIQUE_ADOPTION, t.id);
    this.sortie.resume(session.resume);
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

  sauvegarder(): void {
    try {
      this.persistance.ecrire([...this.sessions.values()].map((s) => s.persistee));
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'écriture des sessions impossible');
    }
  }

  // Les sessions SDK qui tournaient à l'arrêt du poste, avec le texte de leur reprise.
  // Une session fermée gardée avant la lecture du titre dans le transcript : son titre est relu une fois au démarrage.
  private titreRafraichi(p: SessionPersistee): SessionPersistee {
    if (p.resume.statut !== 'fermee') return p;
    const { cwd, id } = p.resume;
    const titre = titreDuTranscript(cheminTranscript(cwd, id, null), cwd, this.journal) ?? p.resume.titre;
    return { ...p, resume: { ...p.resume, titre } };
  }

  private reprisesPrevues(persistees: readonly SessionPersistee[]): ReprisePrevue[] {
    return persistees.flatMap((p) => {
      const prevue = reprisePrevue(p);
      const session = this.sessions.get(p.resume.id);
      return prevue && session instanceof SessionSdk ? [{ session, texte: prevue.texte }] : [];
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
      historique: (id, evts) => this.sortieFil.historique?.(id, evts),
      resume: (r) => {
        this.sortie.resume(r);
        this.planifierSauvegarde();
      },
    };
    // Une session fermée se reprend par le SDK, qu'elle ait été ouverte par le TUI ou non.
    if (p.resume.moteur === 'sdk' || p.resume.statut === 'fermee') {
      const presentation = { stockage: this.stockage, racines: this.config.racines, api: this.config.api };
      const tours = this.modifications.toursDe(p.resume.id, p.resume.cwd);
      const env = { journal: this.journal, sortie, executable: trouverClaude(), socket: this.socket };
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

// Le chemin du transcript et son dossier de configuration restent sur le poste : le relais ne voit que la session.
function sansChemin(t: TranscriptDecouvert): Decouverte {
  const { chemin: _chemin, configDir: _configDir, ...decouverte } = t;
  return decouverte;
}
