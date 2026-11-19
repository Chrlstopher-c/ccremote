// Responsabilité : les sessions Claude du poste — découverte dans tmux, ouverture, commandes du relais, crochets,
// persistance.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { DemandeSession, Moteur, ResumeSession } from '../../commun/session.ts';
import { type ConfigPoste, developper } from '../config.ts';
import { composerConsignes } from './consignes.ts';
import { basculerControle, enBascule } from './bascule-controle.ts';
import { type CommandeSession, estLecture, lecturePanneau } from './lecture-panneau.ts';
import { PersistanceSessions, type SessionPersistee } from './persistance.ts';
import { type ReprisePrevue, relancerApresRedemarrage, reprisePrevue } from './reprise.ts';
import { SessionTmux } from './session-tmux.ts';
import { annexer, dupliquer } from './copie.ts';
import { ControlesDifferes, estAuRepos } from './controle-differe.ts';
import { stylesDeSession } from './styles-session.ts';
import { reglagesDeOuverture } from './reglages-sdk.ts';
import { SessionSdk, trouverClaude } from './session-sdk.ts';
import type { Reglage, SessionPoste, SortieSession } from './session-poste.ts';
import * as tmux from './tmux.ts';
import {
  type Adoptee,
  type Origine,
  ficheAdoptee,
  ficheFermee,
  identitePane,
  adoptionAutorisee,
  identiteProcessus,
  titreDe,
} from './adoption.ts';
import { type ProcessusClaude, processusClaude } from './processus.ts';
import { dossierRegistreCc, type EntreeCc, lireRegistreCc } from './registre-cc.ts';
import { cheminTranscript } from './transcript.ts';
import { ficheImportee, type TranscriptImportable, transcriptsImportables } from './importation.ts';
import { SessionsSupprimees, supprimerTranscript, transcriptsDeLaSession } from './suppression.ts';
import { lireFichierSession } from '../presentation/lecture.ts';
import { estCommandeArtefact, executerArtefacts } from '../presentation/commande-artefacts.ts';
import { estCommandeModifications, ModificationsSessions } from '../modifications/commande-modifications.ts';
import { estFichiersSession, executerFichiersSession, type CommandeFichiersSession } from '../fichiers/session.ts';
import { Stockage } from '../presentation/stockage.ts';
import { titreDuTranscript } from './titre-transcript.ts';

export interface Reponse {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}

const HISTORIQUE_ADOPTION = 150;
const PERIODE_DECOUVERTE_MS = 2_000;
const PERIODE_LECTURE_MS = 700;
const FERMEES_MAX = 50; // sessions cc fermées les plus récentes à proposer à la reprise

function entreeDe(
  entrees: readonly EntreeCc[],
  pane: tmux.PaneTmux,
  proc: ProcessusClaude | undefined,
): EntreeCc | undefined {
  return entrees.find((e) => e.tmux === pane.nom && (proc === undefined || e.id === proc.sessionId));
}

// Le moteur d'une session ouverte depuis l'app : le SDK, sauf demande explicite de tmux (sessions anciennes).
export function moteurDe(d: DemandeSession): Moteur {
  return d.moteur ?? 'sdk';
}

export class GestionnaireSessions {
  readonly sessions = new Map<string, SessionPoste>();
  private readonly persistance: PersistanceSessions;
  private readonly supprimees: SessionsSupprimees;
  private readonly stockage: Stockage;
  private readonly modifications: ModificationsSessions;
  private sauvegardePrevue: ReturnType<typeof setTimeout> | null = null;
  private readonly controles = new ControlesDifferes();

  constructor(
    readonly config: ConfigPoste,
    private readonly sortie: SortieSession,
    private readonly socket: string,
    readonly journal: Logger,
  ) {
    this.persistance = new PersistanceSessions(config.donnees);
    this.supprimees = new SessionsSupprimees(config.donnees);
    this.stockage = new Stockage(config.donnees);
    this.modifications = new ModificationsSessions({
      donnees: config.donnees,
      machine: config.machine,
      journal,
      sortie,
    });
  }

  demarrer(): void {
    const persistees = this.persistance.charger().map((p) => this.titreRafraichi(p));
    for (const p of persistees) this.sessions.set(p.resume.id, this.creer(p));
    void relancerApresRedemarrage(this.reprisesPrevues(persistees), this.journal);
    void this.decouvrir();
    setInterval(() => void this.decouvrir(), PERIODE_DECOUVERTE_MS);
    setInterval(() => this.lireTout(), PERIODE_LECTURE_MS);
  }

  lister(): ResumeSession[] {
    return [...this.sessions.values()].map((s) => s.resume);
  }

  session(id: string): SessionPoste | undefined {
    return this.sessions.get(id);
  }

  // Un compte ne se retire pas sous une session vivante : pane tmux ou requête SDK ouverte.
  enUsage(compte: string): boolean {
    return [...this.sessions.values()].some((s) => s.resume.compte === compte && s.vivante);
  }

  async ouvrir(d: DemandeSession): Promise<Reponse> {
    if (this.sessions.has(d.sessionId)) return { ok: false, erreur: 'session déjà ouverte' };
    const compte = d.compte ?? Object.keys(this.config.comptes)[0] ?? 'principal';
    if (!(compte in this.config.comptes))
      return { ok: false, erreur: `compte inconnu sur ${this.config.machine} : ${compte}` };
    const cwd = this.repertoire(d);
    if (!existsSync(cwd)) return { ok: false, erreur: `projet introuvable sur ${this.config.machine} : ${cwd}` };
    const configDir = this.config.comptes[compte] ?? null;
    const session = this.creer({
      resume: this.resumeInitial(d, cwd, compte),
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
    if (c.kind === 'supprimer') return this.supprimer(c.sessionId);
    if (c.kind === 'dupliquer') return dupliquer(this, c.sessionId, c.messageId);
    if (c.kind === 'annexer') return annexer(this, c.sessionId);
    if (c.kind === 'styles') return this.styles(c.sessionId);
    if (c.kind === 'fichier_session') return this.fichier(c.sessionId, c.fichier);
    if (estCommandeArtefact(c)) return executerArtefacts(this.stockage, c, this.journal);
    if (estFichiersSession(c)) return this.fichiersSession(c);
    if (estCommandeModifications(c)) return this.modifications.executer(c, this.sessions.get(c.sessionId));
    if (c.kind === 'remote_control') return basculerControle(this, c.sessionId, c.actif);
    const s = this.sessions.get(c.sessionId);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    if (enBascule(c.sessionId)) return { ok: false, erreur: 'bascule Remote Control en cours : réessayer' };
    if (estLecture(c)) return { ok: true, donnees: await lecturePanneau(s, c) };
    let erreur: string | null = null;
    if (c.kind === 'envoyer') erreur = await this.envoyerMessage(s, c.texte, c.pieces ?? []);
    else if (c.kind === 'interrompre') erreur = await s.interrompre();
    else if (c.kind === 'rembobiner')
      erreur = s instanceof SessionSdk ? await s.rembobiner(c.messageId) : 'non pris en charge hors SDK';
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
  async supprimer(id: string): Promise<Reponse> {
    const s = this.sessions.get(id);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    if (s instanceof SessionSdk && s.vivante) {
      const erreur = await s.fermer();
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
    return { ok: true, donnees: this.trouverImportables() };
  }

  // Import des identifiants choisis : sessions fermées, reprenables ; l'historique vient du transcript.
  importer(ids: readonly string[]): Reponse {
    const trouves = this.trouverImportables();
    const aImporter = trouves.filter((t) => ids.includes(t.id));
    const absentes = ids.filter((id) => !aImporter.some((t) => t.id === id));
    for (const t of aImporter) this.importerUne(t);
    this.sauvegarder();
    return { ok: true, donnees: { importees: aImporter.length, absentes } };
  }

  // Une session qui tourne en ce moment (processus Claude Code) n'est pas à importer : elle s'écrit encore.
  trouverImportables(): TranscriptImportable[] {
    const configs = this.configDirs();
    const vivantes = new Set(processusClaude(configs, this.journal).map((p) => p.sessionId));
    const ecartee = (id: string): boolean => this.sessions.has(id) || this.supprimees.has(id) || vivantes.has(id);
    return transcriptsImportables(configs, ecartee, this.journal);
  }

  importerUne(t: TranscriptImportable, surcharge: Partial<ResumeSession> = {}, consignes: string | null = null): void {
    const session = this.creer({
      resume: { ...ficheImportee(this.origine(), t), ...surcharge },
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

  creer(p: SessionPersistee): SessionPoste {
    const sortie: SortieSession = {
      evenement: (id, evt) => this.sortie.evenement(id, evt),
      resume: (r) => {
        this.sortie.resume(r);
        this.planifierSauvegarde();
      },
    };
    if (p.resume.moteur === 'sdk') {
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

  private lireTout(): void {
    for (const s of this.sessions.values()) {
      try {
        s.lire();
      } catch (erreur) {
        this.journal.warn({ session: s.resume.id, err: erreur }, 'lecture du transcript en échec');
      }
    }
  }

  private async decouvrir(): Promise<void> {
    const panes = await tmux.lister();
    const procs = processusClaude([null, ...Object.values(this.config.comptes)], this.journal);
    const parPid = new Map(procs.map((p) => [p.pid, p]));
    const entrees = lireRegistreCc(dossierRegistreCc(), this.journal);
    const vus = new Set<string>();
    for (const s of this.sessions.values()) {
      const pane = panes.find((p) => p.nom === s.resume.tmux) ?? null;
      if (pane) vus.add(pane.nom);
      s.rattacher(pane);
      if (!pane) continue;
      const proc = parPid.get(pane.pid);
      const a = identitePane(pane, panes, proc, entreeDe(entrees, pane, proc));
      s.nommer?.(a?.nom ?? null);
      if (a && !s.transcriptConnu) this.associer(s, a);
    }
    for (const pane of panes.filter((p) => !vus.has(p.nom))) this.adopterPane(pane, panes, parPid, entrees);
    this.suivreTerminaux(procs.filter((p) => !p.enTmux), entrees);
    this.suivreFermees(entrees, panes, procs);
    await Promise.all([...this.sessions.values()].map((s) => s.releverEcran()));
    await Promise.all([...this.sessions.values()].map((s) => s.veillerNuit()));
    void this.controles.traiter(this);
  }

  // Un pane sans identifiant réel n'est pas une session adoptable : on le signale, on n'invente pas d'id.
  private adopterPane(
    pane: tmux.PaneTmux,
    panes: readonly tmux.PaneTmux[],
    parPid: ReadonlyMap<number, ProcessusClaude>,
    entrees: readonly EntreeCc[],
  ): void {
    const proc = parPid.get(pane.pid);
    const a = identitePane(pane, panes, proc, entreeDe(entrees, pane, proc));
    if (a) this.adopter(a, pane, pane.dossier);
    else this.journal.debug({ tmux: pane.nom }, 'pane claude sans identifiant : non adoptée');
  }

  // Sessions Claude lancées dans un terminal ordinaire : visibles en lecture, fermées quand leur processus s'arrête.
  private suivreTerminaux(procs: readonly ProcessusClaude[], entrees: readonly EntreeCc[]): void {
    const vivants = new Set(procs.map((p) => p.sessionId));
    for (const s of this.sessions.values()) if (s.resume.terminal) s.rattacherTerminal(vivants.has(s.resume.id));
    for (const p of procs) {
      const connue = this.sessions.get(p.sessionId);
      if (connue) connue.rattacherTerminal(true);
      else this.adopter(identiteProcessus(p, entrees.find((e) => e.id === p.sessionId)), null, p.cwd);
    }
  }

  // Sessions cc sans processus ni pane : listées fermées, reprenables par `cc reprendre` (via Quart).
  private suivreFermees(
    entrees: readonly EntreeCc[],
    panes: readonly tmux.PaneTmux[],
    procs: readonly ProcessusClaude[],
  ): void {
    const vivants = new Set([
      ...procs.map((p) => p.sessionId),
      ...entrees.filter((e) => panes.some((p) => p.nom === e.tmux)).map((e) => e.id),
    ]);
    for (const e of entrees.slice(0, FERMEES_MAX)) {
      if (this.sessions.has(e.id) || vivants.has(e.id) || this.supprimees.has(e.id)) continue;
      const titre = titreDuTranscript(cheminTranscript(e.cwd, e.id, null), e.cwd, this.journal) ?? titreDe(e.nom, null, e.cwd);
      const resume = ficheFermee(this.origine(), e, titre);
      this.sessions.set(e.id, this.creer({ resume, consignes: null, configDir: null, transcript: null, position: 0, aReprendre: false }));
    }
  }

  // Une session lancée hors ccremote (bureau, Atrium, terminal) : suivie en lecture ; dans tmux, pilotable par tmux.
  private adopter(a: Adoptee, pane: tmux.PaneTmux | null, dossier = pane?.dossier ?? ''): void {
    if (!adoptionAutorisee(a.id, this.supprimees)) return;
    const connue = this.sessions.get(a.id);
    if (connue) return connue.rattacher(pane);
    const titre =
      (a.transcript ? titreDuTranscript(a.transcript.chemin, dossier, this.journal) : null) ??
      titreDe(a.nom, pane?.titre ?? null, dossier);
    const session = this.creer({
      resume: ficheAdoptee(this.origine(), a, dossier, titre, pane),
      consignes: null,
      configDir: null,
      transcript: null,
      position: 0,
      aReprendre: false,
    });
    this.sessions.set(a.id, session);
    if (a.transcript) session.definirTranscript(a.transcript.chemin, HISTORIQUE_ADOPTION, a.transcript.id);
    else if (pane) session.rattacher(pane);
    this.journal.info({ tmux: pane?.nom ?? null, id: a.id, terminal: pane === null }, 'session adoptée');
  }

  private origine(): Origine {
    return {
      machine: this.config.machine,
      compte: Object.keys(this.config.comptes)[0] ?? 'principal',
      fenetre: this.config.fenetreContexte,
    };
  }

  // Le transcript d'une session tout juste lancée n'existe qu'après son premier échange : on le cherche à chaque
  // passage.
  private associer(s: SessionPoste, a: Adoptee): void {
    const pris = [...this.sessions.values()].some(
      (autre) => autre !== s && autre.resume.claudeSessionId === a.transcript?.id,
    );
    if (a.transcript && !pris) s.definirTranscript(a.transcript.chemin, HISTORIQUE_ADOPTION, a.transcript.id);
  }

  // Projet d'une autre machine : la session travaille via ssh depuis un espace local dédié.
  private repertoire(d: DemandeSession): string {
    if (d.projet.machine === this.config.machine) return developper(d.projet.chemin.trim() || '~');
    const espace = join(this.config.donnees, 'espaces', d.sessionId);
    mkdirSync(espace, { recursive: true });
    return espace;
  }

  private resumeInitial(d: DemandeSession, cwd: string, compte: string): ResumeSession {
    const maintenant = new Date().toISOString();
    return {
      id: d.sessionId,
      machine: this.config.machine,
      projet: d.projet,
      cwd,
      titre: d.titre,
      objectif: d.objectif,
      modele: d.modele ?? 'défaut',
      compte,
      autonomie: d.autonomie,
      statut: 'demarrage',
      contexte: { tokens: 0, max: this.config.fenetreContexte },
      etapes: 0,
      compactions: 0,
      claudeSessionId: d.sessionId,
      moteur: moteurDe(d),
      style_sortie: d.style_sortie ?? null,
      bac_a_sable: d.bac_a_sable ?? 'non',
      tmux: null,
      attachee: false,
      pilotee: true,
      creeLe: maintenant,
      majLe: maintenant,
    };
  }
}
