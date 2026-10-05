// Responsabilité : les sessions Claude du poste — découverte dans tmux, ouverture, commandes du relais, crochets,
// persistance.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import type { DemandeSession, ResumeSession } from '../../commun/session.ts';
import type { ConfigPoste } from '../config.ts';
import { composerConsignes } from './consignes.ts';
import { PersistanceSessions, type SessionPersistee } from './persistance.ts';
import { SessionTmux, type SortieSession } from './session-tmux.ts';
import * as tmux from './tmux.ts';
import { type Adoptee, ficheAdoptee, transcriptDuPane, transcriptDuProcessus } from './adoption.ts';
import { type ProcessusClaude, processusClaude } from './processus.ts';
import { cheminTranscript } from './transcript.ts';

export interface Reponse {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
}
type CommandeSession = Extract<CommandeRelais, { sessionId: string }>;

const HISTORIQUE_ADOPTION = 150;
const PERIODE_DECOUVERTE_MS = 2_000;
const PERIODE_LECTURE_MS = 700;

export class GestionnaireSessions {
  private readonly sessions = new Map<string, SessionTmux>();
  private readonly persistance: PersistanceSessions;
  private sauvegardePrevue: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ConfigPoste,
    private readonly sortie: SortieSession,
    private readonly socket: string,
    private readonly journal: Logger,
  ) {
    this.persistance = new PersistanceSessions(config.donnees);
  }

  demarrer(): void {
    for (const p of this.persistance.charger()) this.sessions.set(p.resume.id, this.creer(p));
    void this.decouvrir();
    setInterval(() => void this.decouvrir(), PERIODE_DECOUVERTE_MS);
    setInterval(() => this.lireTout(), PERIODE_LECTURE_MS);
  }

  lister(): ResumeSession[] {
    return [...this.sessions.values()].map((s) => s.resume);
  }

  session(id: string): SessionTmux | undefined {
    return this.sessions.get(id);
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
      consignes: composerConsignes({ machine: this.config.machine, cwd, demande: d }),
      configDir,
      transcript: cheminTranscript(cwd, d.sessionId, configDir),
      position: 0,
    });
    this.sessions.set(d.sessionId, session);
    const erreur = await session.lancer(d.message, d.modele ?? null);
    if (erreur) {
      this.sessions.delete(d.sessionId);
      return { ok: false, erreur };
    }
    return { ok: true, donnees: session.resume };
  }

  async executer(c: CommandeSession): Promise<Reponse> {
    const s = this.sessions.get(c.sessionId);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.config.machine}` };
    let erreur: string | null = null;
    if (c.kind === 'envoyer') erreur = await s.envoyer(c.texte);
    else if (c.kind === 'interrompre') erreur = await s.interrompre();
    else if (c.kind === 'compacter') erreur = await s.compacter();
    else if (c.kind === 'fermer') erreur = await s.fermer();
    else if (c.kind === 'reprendre') erreur = await s.reprendre();
    else if (c.kind === 'autonomie') s.basculerAutonomie(c.active);
    else if (c.kind === 'nuit') erreur = await s.basculerNuit(c.active, c.objectif);
    else if (c.kind === 'repondre') erreur = await s.repondre(c.reponse);
    return erreur ? { ok: false, erreur } : { ok: true, donnees: s.resume };
  }

  sauvegarder(): void {
    try {
      this.persistance.ecrire([...this.sessions.values()].map((s) => s.persistee));
    } catch (erreur) {
      this.journal.error({ err: erreur }, 'écriture des sessions impossible');
    }
  }

  private creer(p: SessionPersistee): SessionTmux {
    const sortie: SortieSession = {
      evenement: (id, evt) => this.sortie.evenement(id, evt),
      resume: (r) => {
        this.sortie.resume(r);
        this.planifierSauvegarde();
      },
    };
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
    const procs = processusClaude([null, ...Object.values(this.config.comptes)]);
    const parPid = new Map(procs.map((p) => [p.pid, p]));
    const vus = new Set<string>();
    for (const s of this.sessions.values()) {
      const pane = panes.find((p) => p.nom === s.resume.tmux) ?? null;
      if (pane) vus.add(pane.nom);
      s.rattacher(pane);
      if (pane && !s.transcriptConnu) this.associer(s, transcriptDuPane(pane, panes, parPid.get(pane.pid)));
    }
    for (const pane of panes.filter((p) => !vus.has(p.nom)))
      this.adopter(transcriptDuPane(pane, panes, parPid.get(pane.pid)), pane);
    this.suivreTerminaux(procs.filter((p) => !p.enTmux));
    await Promise.all([...this.sessions.values()].map((s) => s.releverEcran()));
    await Promise.all([...this.sessions.values()].map((s) => s.veillerNuit()));
  }

  // Sessions Claude lancées dans un terminal ordinaire : visibles en lecture, fermées quand leur processus s'arrête.
  private suivreTerminaux(procs: readonly ProcessusClaude[]): void {
    const vivants = new Set(procs.map((p) => p.sessionId));
    for (const s of this.sessions.values()) if (s.resume.terminal) s.rattacherTerminal(vivants.has(s.resume.id));
    for (const p of procs) {
      const connue = this.sessions.get(p.sessionId);
      if (connue) connue.rattacherTerminal(true);
      else this.adopter(transcriptDuProcessus(p), null, p.cwd);
    }
  }

  // Une session lancée hors ccremote (bureau, Atrium, terminal) : suivie en lecture ; dans tmux, pilotable par tmux.
  private adopter(a: Adoptee, pane: tmux.PaneTmux | null, dossier = pane?.dossier ?? ''): void {
    const connue = this.sessions.get(a.id);
    if (connue) return connue.rattacher(pane);
    const origine = {
      machine: this.config.machine,
      compte: Object.keys(this.config.comptes)[0] ?? 'principal',
      fenetre: this.config.fenetreContexte,
    };
    const titre = pane?.titre ?? dossier.split('/').at(-1) ?? 'Claude';
    const session = this.creer({
      resume: ficheAdoptee(origine, a, dossier, titre, pane),
      consignes: null,
      configDir: null,
      transcript: null,
      position: 0,
    });
    this.sessions.set(a.id, session);
    if (a.transcript) session.definirTranscript(a.transcript.chemin, HISTORIQUE_ADOPTION, a.transcript.id);
    else if (pane) session.rattacher(pane);
    this.journal.info({ tmux: pane?.nom ?? null, id: a.id, terminal: pane === null }, 'session adoptée');
  }

  // Le transcript d'une session tout juste lancée n'existe qu'après son premier échange : on le cherche à chaque
  // passage.
  private associer(s: SessionTmux, a: Adoptee): void {
    const pris = [...this.sessions.values()].some(
      (autre) => autre !== s && autre.resume.claudeSessionId === a.transcript?.id,
    );
    if (a.transcript && !pris) s.definirTranscript(a.transcript.chemin, HISTORIQUE_ADOPTION, a.transcript.id);
  }

  // Projet d'une autre machine : la session travaille via ssh depuis un espace local dédié.
  private repertoire(d: DemandeSession): string {
    if (d.projet.machine === this.config.machine) return d.projet.chemin;
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
      tmux: null,
      attachee: false,
      pilotee: true,
      creeLe: maintenant,
      majLe: maintenant,
    };
  }
}
