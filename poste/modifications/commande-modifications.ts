// Responsabilité : exécuter sur le poste les commandes du relais qui touchent aux modifications d'une session (git de
// son dossier, fichiers touchés par tour), et tenir les tours des sessions SDK. Une erreur est journalisée et rendue au
// relais comme un refus, jamais propagée.
import type { Logger } from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { SortieSession } from '../session/session-poste.ts';
import { dossierDeTravail } from '../parite/depot.ts';
import { transcriptDeSession } from '../parite/transcript-session.ts';
import { DepotGit } from './git.ts';
import { ToursSession } from './tours.ts';

export type CommandeModifications = Extract<
  CommandeRelais,
  {
    kind:
      | 'git_modifications'
      | 'git_diff'
      | 'git_annuler'
      | 'git_commiter'
      | 'tour_modifications'
      | 'tour_diff'
      | 'tour_annuler';
  }
>;
type CommandeGit = Extract<CommandeModifications, { kind: `git_${string}` }>;
type CommandeTour = Extract<CommandeModifications, { kind: `tour_${string}` }>;

export interface ReponseModifications {
  readonly ok: boolean;
  readonly erreur?: string;
  readonly donnees?: unknown;
  readonly evenement?: Evenement; // événement de fil à publier après un geste réussi
}

export const estCommandeModifications = (c: CommandeRelais): c is CommandeModifications =>
  c.kind.startsWith('git_') || c.kind.startsWith('tour_');

const estGit = (c: CommandeModifications): c is CommandeGit => c.kind.startsWith('git_');

const reussi = (donnees: unknown): ReponseModifications => ({ ok: true, donnees });

async function executerGit(c: CommandeGit, cwd: string, journal: Logger): Promise<ReponseModifications> {
  const depot = new DepotGit(cwd, journal);
  switch (c.kind) {
    case 'git_modifications':
      return reussi(await depot.modifications(c.portee));
    case 'git_diff':
      return reussi(await depot.diff(c.chemin, c.portee));
    case 'git_annuler':
      await depot.annuler(c.chemin);
      return reussi({});
    case 'git_commiter':
      return reussi({ hash: await depot.commiter(c.message) });
  }
}

async function executerTour(c: CommandeTour, tours: ToursSession | null): Promise<ReponseModifications> {
  if (!tours) throw new Error('tour inconnu');
  switch (c.kind) {
    case 'tour_modifications':
      return reussi(await tours.modifications(c.tour));
    case 'tour_diff':
      return reussi(tours.diff(c.tour, c.chemin));
    case 'tour_annuler': {
      const annule = tours.annuler(c.tour);
      return {
        ok: true,
        donnees: { fichiers: annule.fichiers, tour: annule.tour },
        evenement: { type: 'tour_annule', tour: annule.tour },
      };
    }
  }
}

export interface ContexteModifications {
  readonly cwd: string;
  readonly tours: ToursSession | null; // null : session sans capture (moteur tmux)
  readonly journal: Logger;
}

export async function executerModifications(
  c: CommandeModifications,
  ctx: ContexteModifications,
): Promise<ReponseModifications> {
  try {
    return estGit(c) ? await executerGit(c, ctx.cwd, ctx.journal) : await executerTour(c, ctx.tours);
  } catch (erreur) {
    ctx.journal.warn({ err: erreur, session: c.sessionId, commande: c.kind }, 'geste sur les modifications refusé');
    return { ok: false, erreur: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}

export interface ParametresModificationsSessions {
  readonly donnees: string;
  readonly machine: string;
  readonly journal: Logger;
  readonly sortie: SortieSession;
}

/** Les tours des sessions SDK du poste, créés à la demande ; l'état d'un tour vit sur le disque, pas ici. */
export class ModificationsSessions {
  private readonly tours = new Map<string, ToursSession>();

  constructor(private readonly p: ParametresModificationsSessions) {}

  /** Le registre des tours d'une session SDK : capture (crochet) et lecture partagent le même objet. */
  toursDe(sessionId: string, cwd: string): ToursSession {
    const existant = this.tours.get(sessionId);
    if (existant) return existant;
    const tours = new ToursSession({ sessionId, racine: cwd, donnees: this.p.donnees, journal: this.p.journal });
    this.tours.set(sessionId, tours);
    return tours;
  }

  oublier(sessionId: string): void {
    this.tours.delete(sessionId);
  }

  async executer(
    c: CommandeModifications,
    s: { readonly resume: ResumeSession; readonly persistee?: { readonly configDir: string | null } } | undefined,
  ): Promise<ReponseModifications> {
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.p.machine}` };
    const tours = s.resume.moteur === 'sdk' ? this.toursDe(c.sessionId, s.resume.cwd) : null;
    const transcript = transcriptDeSession(s.resume, s.persistee?.configDir, [], this.p.journal);
    const cwd = c.kind.startsWith('git_')
      ? await dossierDeTravail(s.resume.cwd, transcript, this.p.journal)
      : s.resume.cwd;
    const r = await executerModifications(c, { cwd, tours, journal: this.p.journal });
    if (r.evenement) this.p.sortie.evenement(c.sessionId, r.evenement);
    return r;
  }
}
