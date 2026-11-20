// Responsabilité : le balayage du poste qui adopte les sessions Claude Code vues sans que Lanterne les ait ouvertes
// (pane tmux, terminal ordinaire, registre des sessions fermées) et tient leurs fiches à jour. Le gestionnaire le
// déclenche à chaque passage ; ce module ne connaît que les dépendances qu'on lui donne.
import type { Logger } from 'pino';
import type { ConfigPoste } from '../config.ts';
import {
  type Adoptee,
  type Origine,
  adoptionAutorisee,
  ficheAdoptee,
  ficheFermee,
  identitePane,
  identiteProcessus,
  titreDe,
} from './adoption.ts';
import { cheminTranscript } from './transcript.ts';
import { titreDuTranscript } from './titre-transcript.ts';
import { modeleDuTranscript } from './modele-transcript.ts';
import { type ProcessusClaude, processusClaude } from './processus.ts';
import { type EntreeCc, dossierRegistreCc, lireRegistreCc } from './registre-cc.ts';
import type { SessionPersistee } from './persistance.ts';
import type { SessionPoste } from './session-poste.ts';
import type { SessionsSupprimees } from './suppression.ts';
import * as tmux from './tmux.ts';

export const HISTORIQUE_ADOPTION = 150;
const FERMEES_MAX = 50; // sessions cc fermées les plus récentes à proposer à la reprise

export interface DependancesBalayage {
  readonly config: ConfigPoste;
  readonly journal: Logger;
  readonly sessions: Map<string, SessionPoste>;
  readonly supprimees: SessionsSupprimees;
  readonly fichePour: (id: string) => SessionPoste | undefined;
  readonly creer: (p: SessionPersistee) => SessionPoste;
}

export function origineDe(config: ConfigPoste): Origine {
  return {
    machine: config.machine,
    compte: Object.keys(config.comptes)[0] ?? 'principal',
    fenetre: config.fenetreContexte,
  };
}

function entreeDe(
  entrees: readonly EntreeCc[],
  pane: tmux.PaneTmux,
  proc: ProcessusClaude | undefined,
): EntreeCc | undefined {
  return entrees.find((e) => e.tmux === pane.nom && (proc === undefined || e.id === proc.sessionId));
}

export class BalayageSessions {
  constructor(private readonly d: DependancesBalayage) {}

  /** Un passage : panes, terminaux et registre sont relus, les sessions nouvelles adoptées, les disparues marquées. */
  async rafraichir(): Promise<void> {
    const panes = await tmux.lister();
    const procs = processusClaude([null, ...Object.values(this.d.config.comptes)], this.d.journal);
    const parPid = new Map(procs.map((p) => [p.pid, p]));
    const entrees = lireRegistreCc(dossierRegistreCc(), this.d.journal);
    const vus = new Set<string>();
    for (const s of this.d.sessions.values()) {
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
    // CCREMOTE_ADOPTER_TERMINAUX=non : ne lit pas les Claude lancés hors tmux (moteur intégré, isolement d'essai).
    const terminaux = process.env['CCREMOTE_ADOPTER_TERMINAUX'] !== 'non';
    this.suivreTerminaux(terminaux ? procs.filter((p) => !p.enTmux) : [], entrees);
    this.suivreFermees(entrees, panes, procs);
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
    else this.d.journal.debug({ tmux: pane.nom }, 'pane claude sans identifiant : non adoptée');
  }

  // Sessions Claude lancées dans un terminal ordinaire : visibles en lecture, fermées quand leur processus s'arrête.
  private suivreTerminaux(procs: readonly ProcessusClaude[], entrees: readonly EntreeCc[]): void {
    const vivants = new Set(procs.map((p) => p.sessionId));
    for (const s of this.d.sessions.values()) if (s.resume.terminal) s.rattacherTerminal(vivants.has(s.resume.id));
    for (const p of procs) {
      const connue = this.d.fichePour(p.sessionId);
      if (connue) connue.rattacherTerminal(true);
      else if (!this.d.fichePour(p.sessionId)) {
        this.adopter(identiteProcessus(p, entrees.find((e) => e.id === p.sessionId)), null, p.cwd);
      }
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
      if (this.d.fichePour(e.id) || vivants.has(e.id) || this.d.supprimees.has(e.id)) continue;
      this.ajouterFermee(e);
    }
  }

  // Fiche fermée d'une entrée du registre Claude Code : titre et modèle relus dans son transcript.
  ajouterFermee(e: EntreeCc): void {
    const chemin = cheminTranscript(e.cwd, e.id, null);
    const titre = titreDuTranscript(chemin, e.cwd, this.d.journal) ?? titreDe(e.nom, null, e.cwd);
    const modele = modeleDuTranscript(chemin, this.d.journal) ?? 'défaut';
    const resume = { ...ficheFermee(origineDe(this.d.config), e, titre), modele };
    const session = this.d.creer({
      resume,
      consignes: null,
      configDir: null,
      transcript: null,
      position: 0,
      aReprendre: false,
    });
    this.d.sessions.set(e.id, session);
  }

  // Une session lancée hors ccremote (bureau, Atrium, terminal) : suivie en lecture ; dans tmux, pilotable par tmux.
  private adopter(a: Adoptee, pane: tmux.PaneTmux | null, dossier = pane?.dossier ?? ''): void {
    if (!adoptionAutorisee(a.id, this.d.supprimees)) return;
    const connue = this.d.fichePour(a.id);
    if (connue) return connue.rattacher(pane);
    const titre =
      (a.transcript ? titreDuTranscript(a.transcript.chemin, dossier, this.d.journal) : null) ??
      titreDe(a.nom, pane?.titre ?? null, dossier);
    const session = this.d.creer({
      resume: ficheAdoptee(origineDe(this.d.config), a, dossier, titre, pane),
      consignes: null,
      configDir: null,
      transcript: null,
      position: 0,
      aReprendre: false,
    });
    this.d.sessions.set(a.id, session);
    if (a.transcript) session.definirTranscript(a.transcript.chemin, HISTORIQUE_ADOPTION, a.transcript.id);
    else if (pane) session.rattacher(pane);
    this.d.journal.info({ tmux: pane?.nom ?? null, id: a.id, terminal: pane === null }, 'session adoptée');
  }

  // Le transcript d'une session tout juste lancée n'existe qu'après son premier échange : on le cherche à chaque
  // passage.
  private associer(s: SessionPoste, a: Adoptee): void {
    const pris = [...this.d.sessions.values()].some(
      (autre) => autre !== s && autre.resume.claudeSessionId === a.transcript?.id,
    );
    if (a.transcript && !pris) s.definirTranscript(a.transcript.chemin, HISTORIQUE_ADOPTION, a.transcript.id);
  }
}
