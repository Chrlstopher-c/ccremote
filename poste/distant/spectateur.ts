// Responsabilité : le spectateur claude.ai du poste — pour chaque compte suivi en Remote Control, relit la liste de ses
// sessions toutes les 5 s et tient à jour les SessionDistante publiées au relais ; le fil de chaque session arrive en
// direct par son flux SSE (le sondage ne sert qu'en secours). Rien n'est persisté. Une session déjà tenue par le
// gestionnaire du poste n'est pas doublée.
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { type CommandeSession, estLecture } from '../session/lecture-panneau.ts';
import { type ConfigPoste, enregistrerDistants } from '../config.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import type { SortieSession } from '../session/session-poste.ts';
import { listerSessions } from './client-claude-ai.ts';
import type { SessionBrute } from './donnees.ts';
import type { Stockage } from '../presentation/stockage.ts';
import { PAS_ENCORE_CLAUDE_AI, SessionDistante } from './session-distante.ts';

const PERIODE_MS = 5_000;

export interface DependancesSpectateur {
  readonly config: ConfigPoste;
  readonly journal: Logger;
  readonly sortie: SortieSession;
  /** Les sessions que le gestionnaire tient déjà sur ce poste : une session Remote Control ouverte ici n'est pas
  doublée. */
  readonly locales: () => readonly ResumeSession[];
  readonly periodeMs?: number;
  /** Stockage des pièces du fil (images, documents des messages). */
  readonly stockage?: Stockage;
}

// Commandes que claude.ai sait recevoir ; les autres (compacter, fermer, autonomie…) restent refusées.
const COMMANDES_DISTANTES = new Set([
  'envoyer',
  'interrompre',
  'repondre',
  'mode',
  'modele',
  'effort',
  'style',
  'renommer',
]);

export class Spectateur {
  private readonly sessions = new Map<string, SessionDistante>();
  private readonly minuteries = new Map<string, ReturnType<typeof setInterval>>();
  private readonly enCours = new Set<string>();

  constructor(private readonly d: DependancesSpectateur) {}

  /** Lance le suivi des comptes déjà activés dans la configuration. */
  demarrer(): void {
    for (const nom of this.d.config.distants) this.activer(nom);
  }

  arreter(): void {
    for (const minuterie of this.minuteries.values()) clearInterval(minuterie);
    this.minuteries.clear();
    for (const s of this.sessions.values()) s.arreterFlux();
  }

  lister(): ResumeSession[] {
    return [...this.sessions.values()].map((s) => s.resume);
  }

  session(id: string): SessionDistante | undefined {
    return this.sessions.get(id);
  }

  /** Active ou coupe le suivi d'un compte. La configuration est réécrite avant tout changement en mémoire. */
  basculer(nom: string, actif: boolean): Reponse {
    if (!Object.hasOwn(this.d.config.comptes, nom)) {
      return { ok: false, erreur: `compte ${nom} inconnu sur ${this.d.config.machine}` };
    }
    if (this.d.config.distants.includes(nom) === actif) return { ok: true };
    const suivants = actif ? [...this.d.config.distants, nom] : this.d.config.distants.filter((n) => n !== nom);
    try {
      enregistrerDistants(suivants);
    } catch (erreur) {
      this.d.journal.error({ err: erreur, compte: nom }, 'comptes distants : configuration non écrite');
      return { ok: false, erreur: 'écriture de la configuration impossible' };
    }
    this.d.config.distants.splice(0, this.d.config.distants.length, ...suivants);
    if (actif) this.activer(nom);
    else this.couper(nom);
    this.d.journal.info({ compte: nom, actif }, 'sessions Remote Control d’un compte');
    return { ok: true };
  }

  /** Le message d'erreur si cette commande ne peut pas viser cette session suivie ; null si elle peut, ou si la
  session n'est pas suivie. */
  refusPour(id: string, c: CommandeSession): string | null {
    if (!this.sessions.has(id) || estLecture(c)) return null;
    return COMMANDES_DISTANTES.has(c.kind) ? null : PAS_ENCORE_CLAUDE_AI;
  }

  /** Relit l'historique d'une session suivie et le réémet au relais. */
  async rejouer(id: string): Promise<Reponse> {
    const s = this.sessions.get(id);
    if (!s) return { ok: false, erreur: `session inconnue sur ${this.d.config.machine}` };
    const r = await s.charger();
    return r.ok ? { ok: true, donnees: { evenements: r.donnees } } : { ok: false, erreur: r.probleme };
  }

  private activer(nom: string): void {
    if (this.minuteries.has(nom) || !Object.hasOwn(this.d.config.comptes, nom)) return;
    this.minuteries.set(
      nom,
      setInterval(() => void this.tour(nom), this.d.periodeMs ?? PERIODE_MS),
    );
    void this.tour(nom);
  }

  private couper(nom: string): void {
    const minuterie = this.minuteries.get(nom);
    if (minuterie) clearInterval(minuterie);
    this.minuteries.delete(nom);
    for (const s of this.sessionsDe(nom)) this.retirer(s);
  }

  // Un seul tour à la fois par compte : une liste lente ne se superpose pas à la suivante.
  private async tour(nom: string): Promise<void> {
    if (this.enCours.has(nom)) return;
    this.enCours.add(nom);
    try {
      await this.relever(nom);
    } catch (erreur) {
      this.d.journal.error({ err: erreur, compte: nom }, 'sessions Remote Control : tour en échec');
    } finally {
      this.enCours.delete(nom);
    }
  }

  private async relever(nom: string): Promise<void> {
    const dossier = this.d.config.comptes[nom];
    if (dossier === undefined) return;
    const liste = await listerSessions(dossier, this.d.journal);
    if (!liste.ok) {
      this.marquerProbleme(nom, liste.probleme);
      return;
    }
    const actives = liste.donnees.filter((s) => this.estSuivable(s));
    for (const brute of actives) await this.synchroniser(nom, dossier, brute);
    const vues = new Set(actives.map((s) => s.id));
    for (const s of this.sessionsDe(nom)) if (!vues.has(s.resume.id)) this.retirer(s);
  }

  private estSuivable(s: SessionBrute): boolean {
    return s.bridge && s.active && !this.estLocale(s.id);
  }

  // Remote Control déjà ouvert sur ce poste : le gestionnaire la tient, le spectateur ne la double pas.
  private estLocale(idDistant: string): boolean {
    return this.d.locales().some((r) => r.remoteControl?.url?.includes(idDistant) === true);
  }

  private async synchroniser(nom: string, dossier: string | null, brute: SessionBrute): Promise<void> {
    let s = this.sessions.get(brute.id);
    if (!s) {
      s = this.creer(nom, dossier, brute);
      this.publier(s);
    }
    const probleme = await s.synchroniser(brute);
    s.marquerProbleme(probleme);
    this.publier(s);
  }

  private creer(nom: string, dossier: string | null, brute: SessionBrute): SessionDistante {
    const contexte = { machine: this.d.config.machine, compte: nom, fenetreContexte: this.d.config.fenetreContexte };
    const deps = {
      contexte,
      configDir: dossier,
      journal: this.d.journal,
      sortie: this.d.sortie,
      publier: () => this.publier(s),
      ...(this.d.stockage ? { stockage: this.d.stockage } : {}),
    };
    const s = new SessionDistante(deps, brute);
    this.sessions.set(brute.id, s);
    return s;
  }

  // Erreur d'un compte (jeton expiré, accès refusé…) : ses sessions le disent, le tour suivant réessaie.
  private marquerProbleme(nom: string, probleme: string): void {
    for (const s of this.sessionsDe(nom)) {
      s.marquerProbleme(probleme);
      this.publier(s);
    }
  }

  private retirer(s: SessionDistante): void {
    s.passerFermee();
    this.publier(s);
    this.sessions.delete(s.resume.id);
  }

  private sessionsDe(nom: string): SessionDistante[] {
    return [...this.sessions.values()].filter((s) => s.resume.compte === nom);
  }

  private publier(s: SessionDistante): void {
    const resume = s.resumePourPublication();
    if (resume) this.d.sortie.resume(resume);
  }
}
