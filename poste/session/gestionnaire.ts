// Responsabilité : les sessions Claude du poste — découverte dans tmux, ouverture, commandes du relais, crochets, persistance.
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
import { cheminTranscript, retrouverTranscript } from './transcript.ts';

export interface Reponse { readonly ok: boolean; readonly erreur?: string; readonly donnees?: unknown }
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
    if (!(compte in this.config.comptes)) return { ok: false, erreur: `compte inconnu sur ${this.config.machine} : ${compte}` };
    const cwd = this.repertoire(d);
    if (!existsSync(cwd)) return { ok: false, erreur: `projet introuvable sur ${this.config.machine} : ${cwd}` };
    const configDir = this.config.comptes[compte] ?? null;
    const session = this.creer({
      resume: this.resumeInitial(d, cwd, compte), consignes: composerConsignes({ machine: this.config.machine, cwd, demande: d }),
      configDir, transcript: cheminTranscript(cwd, d.sessionId, configDir), position: 0,
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
    const vus = new Set<string>();
    for (const s of this.sessions.values()) {
      const pane = panes.find((p) => p.nom === s.resume.tmux) ?? null;
      if (pane) vus.add(pane.nom);
      s.rattacher(pane);
      if (pane && !s.transcriptConnu) this.associer(s, pane, panes);
    }
    for (const pane of panes.filter((p) => !vus.has(p.nom))) this.adopter(pane, panes);
  }

  // Une session tmux lancée hors ccremote (bureau, Atrium, relais) : suivie en lecture, pilotable par tmux.
  private adopter(pane: tmux.PaneTmux, panes: readonly tmux.PaneTmux[]): void {
    const voisins = panes.filter((p) => p.dossier === pane.dossier).length;
    const transcript = retrouverTranscript(pane.dossier, pane.titre, voisins, null);
    const id = transcript?.id ?? `tmux-${this.config.machine}-${pane.nom}-${pane.creeLe}`;
    const connue = this.sessions.get(id);
    if (connue) return connue.rattacher(pane);
    const maintenant = new Date().toISOString();
    const session = this.creer({
      resume: {
        id, machine: this.config.machine, projet: { machine: this.config.machine, chemin: pane.dossier, nom: pane.dossier.split('/').at(-1) ?? pane.dossier },
        cwd: pane.dossier, titre: pane.titre, objectif: null, modele: 'défaut', compte: Object.keys(this.config.comptes)[0] ?? 'principal',
        autonomie: false, statut: 'attente', contexte: { tokens: 0, max: this.config.fenetreContexte }, etapes: 0, compactions: 0,
        claudeSessionId: transcript?.id ?? null, tmux: pane.nom, attachee: pane.attachee, pilotee: false, creeLe: maintenant, majLe: maintenant,
      },
      consignes: null, configDir: null, transcript: null, position: 0,
    });
    this.sessions.set(id, session);
    if (transcript) session.definirTranscript(transcript.chemin, HISTORIQUE_ADOPTION, transcript.id);
    else session.rattacher(pane);
    this.journal.info({ tmux: pane.nom, id, transcript: transcript?.chemin ?? null }, 'session tmux adoptée');
  }

  // Le transcript d'une session tout juste lancée n'existe qu'après son premier échange : on le cherche à chaque passage.
  private associer(s: SessionTmux, pane: tmux.PaneTmux, panes: readonly tmux.PaneTmux[]): void {
    const voisins = panes.filter((p) => p.dossier === pane.dossier).length;
    const t = retrouverTranscript(pane.dossier, pane.titre, voisins, null);
    const pris = [...this.sessions.values()].some((autre) => autre !== s && autre.resume.claudeSessionId === t?.id);
    if (t && !pris) s.definirTranscript(t.chemin, HISTORIQUE_ADOPTION, t.id);
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
      id: d.sessionId, machine: this.config.machine, projet: d.projet, cwd, titre: d.titre, objectif: d.objectif,
      modele: d.modele ?? 'défaut', compte, autonomie: d.autonomie, statut: 'demarrage',
      contexte: { tokens: 0, max: this.config.fenetreContexte }, etapes: 0, compactions: 0, claudeSessionId: d.sessionId,
      tmux: null, attachee: false, pilotee: true, creeLe: maintenant, majLe: maintenant,
    };
  }
}
