// Responsabilité : UNE session Remote Control d'un compte, vue depuis le poste par l'API de claude.ai. Implémente le
// contrat SessionPoste en lecture seule : historique relu (~400 derniers événements), suivi du fil en direct. Le
// pilotage (envoyer, interrompre, répondre…) n'est pas encore pris en charge. Rien n'est écrit sur disque.
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { SessionPersistee } from '../session/persistance.ts';
import type { ReponseCrochet, SessionPoste, SortieSession } from '../session/session-poste.ts';
import { type EtatTraduction, nouvelEtatTraduction } from '../session/traduction-sdk.ts';
import { type ResultatApi, lireEvenements } from './client-claude-ai.ts';
import type { EvenementBrut, SessionBrute } from './donnees.ts';
import { type ContexteDistant, resumeDistant } from './resume-distant.ts';
import { traduireLot } from './traduction-distante.ts';

export const PAS_ENCORE_CLAUDE_AI = 'pilotage claude.ai : pas encore pris en charge';

const TAILLE_PAGE = 100;
const PAGES_HISTORIQUE = 4; // ~400 derniers événements au premier chargement
const PAGES_DIRECT = 5; // plafond d'une lecture de suivi : au-delà, le reste n'est pas relu

export interface DependancesDistante {
  readonly contexte: ContexteDistant;
  readonly configDir: string | null;
  readonly journal: Logger;
  readonly sortie: SortieSession;
}

export class SessionDistante implements SessionPoste {
  resume: ResumeSession;
  readonly identifiants: readonly string[] = [];
  readonly transcriptConnu = false;
  private etat: EtatTraduction = nouvelEtatTraduction();
  private vus = new Set<string>(); // identifiants des événements déjà émis : jamais deux fois le même
  private derniereListe: string | null; // dernier événement vu dans la liste claude.ai (repère du suivi)
  private vuJusqua: string | null = null; // le même repère, au moment où le fil a été lu pour la dernière fois
  private chargee = false; // historique lu avec succès : sans lui, le premier passage recommence
  private publie = ''; // dernier résumé publié, pour ne publier que les changements

  constructor(
    private readonly d: DependancesDistante,
    brute: SessionBrute,
  ) {
    this.resume = resumeDistant(brute, d.contexte, new Date().toISOString());
    this.derniereListe = brute.dernierEvenement;
  }

  get persistee(): SessionPersistee {
    const { resume, d } = this;
    return { resume, consignes: null, configDir: d.configDir, transcript: null, position: 0, aReprendre: false };
  }

  get vivante(): boolean {
    return this.resume.distant?.connexion === 'connectee';
  }

  /** Met le résumé et le fil à jour depuis la liste : historique au premier passage, suite ensuite. Rend l'erreur. */
  async synchroniser(brute: SessionBrute): Promise<string | null> {
    this.resume = resumeDistant(brute, this.d.contexte, this.resume.creeLe);
    this.derniereListe = brute.dernierEvenement;
    if (!this.chargee) return this.erreurDe(await this.charger());
    if (this.derniereListe === this.vuJusqua) return null;
    return this.erreurDe(await this.suivre());
  }

  private erreurDe(r: ResultatApi<number>): string | null {
    return r.ok ? null : r.probleme;
  }

  /** Le résumé s'il a changé depuis la dernière publication, sinon null. */
  resumePourPublication(): ResumeSession | null {
    const signature = JSON.stringify(this.resume);
    if (signature === this.publie) return null;
    this.publie = signature;
    return this.resume;
  }

  marquerProbleme(probleme: string | null): void {
    const distant = this.resume.distant ?? null;
    if (distant) this.resume = { ...this.resume, distant: { ...distant, probleme } };
  }

  /** La session n'est plus dans la liste active de claude.ai : elle est rangée ou la connexion est tombée. */
  passerFermee(): void {
    const distant = this.resume.distant ?? null;
    this.resume = {
      ...this.resume,
      statut: 'fermee',
      distant: distant ? { ...distant, connexion: 'deconnectee' } : null,
    };
  }

  /** Historique : relit les derniers événements (le fil repart de zéro), les émet en lot dans l'ordre d'origine. */
  async charger(): Promise<ResultatApi<number>> {
    this.etat = nouvelEtatTraduction();
    this.vus = new Set();
    const r = await this.lirePages(PAGES_HISTORIQUE, () => false);
    if (!r.ok) return r;
    const evenements = traduireLot([...r.donnees].reverse(), this.etat);
    for (const e of r.donnees) this.vus.add(e.id);
    this.vuJusqua = this.derniereListe;
    this.chargee = true;
    if (evenements.length > 0) this.d.sortie.historique?.(this.resume.id, evenements);
    return { ok: true, donnees: evenements.length };
  }

  /** Suivi en direct : émet un à un les événements arrivés depuis le dernier passage. */
  async suivre(): Promise<ResultatApi<number>> {
    const r = await this.lirePages(PAGES_DIRECT, (id) => this.vus.has(id));
    if (!r.ok) return r;
    const nouveaux = [...r.donnees].reverse();
    for (const e of nouveaux) this.vus.add(e.id);
    this.vuJusqua = this.derniereListe;
    for (const h of traduireLot(nouveaux, this.etat)) this.d.sortie.evenement(this.resume.id, h.evt);
    return { ok: true, donnees: nouveaux.length };
  }

  /** Les événements lus page par page, du plus récent au plus ancien ; s'arrête avant le premier déjà connu. */
  private async lirePages(pages: number, dejaConnu: (id: string) => boolean): Promise<ResultatApi<EvenementBrut[]>> {
    const lus: EvenementBrut[] = [];
    let curseur: string | null = null;
    for (let i = 0; i < pages; i++) {
      const page = await lireEvenements(this.d.configDir, this.resume.id, this.d.journal, {
        curseur,
        limite: TAILLE_PAGE,
      });
      if (!page.ok) return { ok: false, statut: page.statut, probleme: page.probleme };
      for (const e of page.donnees.evenements) {
        if (dejaConnu(e.id)) return { ok: true, donnees: lus };
        lus.push(e);
      }
      if (page.donnees.suivant === null || page.donnees.evenements.length === 0) break;
      curseur = page.donnees.suivant;
    }
    return { ok: true, donnees: lus };
  }

  // Commandes : le pilotage n'est pas encore pris en charge pour une session claude.ai.
  lancer(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  envoyer(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  interrompre(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  compacter(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  fermer(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  reprendre(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  basculerNuit(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  repondre(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  reglerSession(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  /** Sans effet : l'autonomie d'une session claude.ai ne se règle pas encore depuis le poste. */
  basculerAutonomie(): void {}

  // Découverte et crochets : rien à rattacher, pas de TUI ni de transcript local.
  rattacher(): void {}
  rattacherTerminal(): void {}
  definirTranscript(): void {}
  lire(): void {}
  async releverEcran(): Promise<void> {}
  async veillerNuit(): Promise<void> {}
  crochet(): ReponseCrochet {
    return {};
  }
  rythme(): string {
    return PAS_ENCORE_CLAUDE_AI;
  }
}
