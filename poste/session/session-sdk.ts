// Responsabilité : UNE session Claude Code pilotée par le Claude Agent SDK — une requête par session, nourrie par les
// messages de Chris ; ses événements traduits vers le fil ; ses questions (AskUserQuestion, ExitPlanMode) rendues à
// Chris comme dialogues ; les autres outils autorisés d'office ; à chaque fin de tour, la politique des sessions tmux
// (relance autonome, compaction, mode nuit), car le SDK n'a pas de hook Stop.
import { randomUUID } from 'node:crypto';
import {
  query as requeteParDefaut,
  type Options,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { Evenement, ReponseDialogue, ResumeSession, StatutSession } from '../../commun/session.ts';
import { BilanTour } from './bilan-tour.ts';
import { FileAsynchrone, messageUtilisateur, messagesAvecConnecteurs } from './file-messages-sdk.ts';
import { binaireClaude, serveurRythme } from './lanceur.ts';
import { basculerNuitClaude, lireNuit, TEXTE_ACTIVATION, TEXTE_RETOUR } from './nuit.ts';
import { optionsSdk } from './options-sdk.ts';
import type { SessionPersistee } from './persistance.ts';
import { CONSIGNE_COMPACTION } from './politique-compaction.ts';
import {
  decisionPlan,
  dialogueDeQuestion,
  OUTIL_PLAN,
  OUTILS_AVIS,
  QUESTION_PLAN,
  questionsDeAskUser,
  type Question,
  valeurReponse,
} from './questions-sdk.ts';
import { RAISON_REDEMARRAGE } from './reprise.ts';
import { effetRythme } from './rythme.ts';
import type { ReponseCrochet, SessionPoste, SortieSession } from './session-poste.ts';
import type { Suite } from './suite-du-tour.ts';
import { SuiviNuit } from './suivi-nuit.ts';
import { type EtatTraduction, nouvelEtatTraduction, type SortieTraduction, traduireSdk } from './traduction-sdk.ts';

// Ce que la session attend du SDK : une requête (flux de messages, interruption, fermeture).
export interface RequeteSdk extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
  mcpServerStatus(): Promise<readonly { readonly status: string }[]>;
}

export type FabriqueRequete = (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => RequeteSdk;

export interface TraductionSdk {
  nouvelEtat(): EtatTraduction;
  traduire(msg: SDKMessage, etat: EtatTraduction): SortieTraduction;
}

export interface EnvironnementSdk {
  readonly journal: Logger;
  readonly sortie: SortieSession;
  readonly executable: string | null;
  readonly socket: string; // socket local du poste : les outils de rythme y relaient leurs appels
  readonly requete?: FabriqueRequete; // injectable : les tests rejouent des messages sans appeler le modèle
  readonly traduction?: TraductionSdk;
  readonly env?: Record<string, string | undefined>;
  readonly delaiMcpMs?: number;
  readonly periodeMcpMs?: number;
}

// Une question en cours : `restantes[0]` est affichée, les réponses déjà données attendent les autres.
interface AvisEnAttente {
  readonly outil: string;
  readonly entree: Record<string, unknown>;
  readonly restantes: Question[];
  readonly reponses: Record<string, string>;
  id: string;
  readonly decide: (r: PermissionResult) => void;
}

const DELAI_MCP_MS = 15_000;
const PERIODE_MCP_MS = 250;
const TRADUCTION_PAR_DEFAUT: TraductionSdk = { nouvelEtat: nouvelEtatTraduction, traduire: traduireSdk };
const TEXTE_INTERRUPTION = 'Interrompu par Chris';
const TEXTE_FERMETURE = 'Session fermée par Chris';

/** Le claude installé sur la machine, ou null (le SDK prend alors son binaire embarqué). */
export function trouverClaude(): string | null {
  return Bun.which(binaireClaude());
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function autoriserSansQuestion(entree: Record<string, unknown>): PermissionResult {
  return { behavior: 'allow', updatedInput: entree };
}

export class SessionSdk implements SessionPoste {
  private etat: ResumeSession;
  private requete: RequeteSdk | null = null;
  private fil: FileAsynchrone<SDKUserMessage> | null = null;
  private avis: AvisEnAttente | null = null;
  private bilan = new BilanTour();
  private readonly fabrique: FabriqueRequete;
  private readonly traduction: TraductionSdk;
  private readonly delaiMcp: number;
  private readonly periodeMcp: number;
  private readonly suiviNuit: SuiviNuit;
  private aReprendre: boolean; // à reprendre au démarrage du poste (voir persistance.ts)

  constructor(
    private readonly p: SessionPersistee,
    private readonly env: EnvironnementSdk,
  ) {
    // Au démarrage du poste aucune requête ne vit : une session persistée est reprenable, pas active.
    this.aReprendre = p.aReprendre;
    const statut = p.aReprendre ? p.resume.statut : 'fermee';
    this.etat = { ...p.resume, statut, dialogue: null, tmux: null, attachee: false, moteur: 'sdk' };
    this.fabrique = env.requete ?? requeteParDefaut;
    this.traduction = env.traduction ?? TRADUCTION_PAR_DEFAUT;
    this.delaiMcp = env.delaiMcpMs ?? DELAI_MCP_MS;
    this.periodeMcp = env.periodeMcpMs ?? PERIODE_MCP_MS;
    this.suiviNuit = new SuiviNuit({
      resume: () => this.etat,
      messagesChrisEnVol: () => this.bilan.enVol,
      publierNuit: (nuit) => this.maj({ nuit }),
      emettre: (evt) => this.emettre(evt),
      coller: (texte) => this.coller(texte),
      journal: () => this.env.journal,
      peutEcrire: () => this.requete !== null && this.fil !== null,
    });
  }

  get resume(): ResumeSession {
    return this.etat;
  }

  get persistee(): SessionPersistee {
    return { ...this.p, resume: this.etat, transcript: null, position: 0, aReprendre: this.aReprendre };
  }

  get transcriptConnu(): boolean {
    return false;
  }

  get vivante(): boolean {
    return this.requete !== null;
  }

  // Pas de pane tmux, de terminal ni de transcript à relire : le fil vient du SDK, la veille est celle du poste.
  rattacher(): void {}
  rattacherTerminal(): void {}
  definirTranscript(): void {}
  lire(): void {}
  async releverEcran(): Promise<void> {}

  veillerNuit(maintenant?: number): Promise<void> {
    return this.suiviNuit.tick(maintenant);
  }

  // Les messages de Chris entrent dans le fil tout de suite : le SDK ne les renvoie pas (contrairement au transcript
  // relu par les sessions tmux).
  async lancer(message: string): Promise<string | null> {
    this.emettre({ type: 'message', texte: message });
    return this.demarrer(false, message);
  }

  async envoyer(texte: string): Promise<string | null> {
    if (!this.fil) return this.reprendre(texte);
    this.emettre({ type: 'message', texte });
    this.bilan.messageDeChris();
    this.pousser(texte);
    if (this.etat.statut !== 'compaction') this.maj({ statut: 'travail' });
    return null;
  }

  async reprendre(message?: string): Promise<string | null> {
    if (this.fil) return message ? this.envoyer(message) : null;
    if (!this.etat.claudeSessionId) return 'conversation inconnue : impossible de la reprendre';
    if (message) this.emettre({ type: 'message', texte: message });
    return this.demarrer(true, message);
  }

  reprendreApresRedemarrage(texte: string | null): string | null {
    if (texte) this.emettre({ type: 'relance', raison: RAISON_REDEMARRAGE });
    const erreur = this.etat.claudeSessionId ? this.demarrer(true, texte ?? undefined) : 'conversation inconnue';
    if (!erreur) return null;
    this.aReprendre = false;
    this.emettre({ type: 'erreur', message: erreur });
    this.maj({ statut: 'fermee' });
    return erreur;
  }

  async interrompre(): Promise<string | null> {
    const requete = this.requete;
    if (!requete) return 'session fermée';
    this.bilan.interrompre();
    this.refuser(this.avis, TEXTE_INTERRUPTION, true);
    try {
      await requete.interrupt();
      return null;
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id }, 'interruption refusée par le SDK');
      return `interruption impossible : ${String(erreur)}`;
    }
  }

  async compacter(): Promise<string | null> {
    if (!this.fil) return 'session fermée';
    if (this.etat.statut === 'travail') {
      this.bilan.demanderCompaction();
      return null;
    }
    this.lancerCompaction('demandée par Chris');
    return null;
  }

  async fermer(): Promise<string | null> {
    const requete = this.requete;
    this.aReprendre = false;
    this.libererRequete(TEXTE_FERMETURE);
    this.maj({ statut: 'fermee', dialogue: null });
    if (!requete) return null;
    try {
      requete.close();
      return null;
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id }, 'fermeture imparfaite du SDK');
      return `fermeture imparfaite : ${String(erreur)}`;
    }
  }

  basculerAutonomie(active: boolean): void {
    this.bilan.reinitialiserRelances();
    this.maj({ autonomie: active });
  }

  async basculerNuit(active: boolean, objectif?: string): Promise<string | null> {
    const id = this.etat.claudeSessionId;
    if (!id) return 'conversation inconnue : mode nuit impossible';
    const erreur = await basculerNuitClaude(id, active, objectif ?? this.etat.objectif ?? this.etat.titre);
    if (erreur) return erreur;
    this.suiviNuit.reinitialiser();
    this.maj({ nuit: lireNuit(id, Date.now(), 0) });
    return this.envoyer(active ? TEXTE_ACTIVATION : TEXTE_RETOUR);
  }

  async repondre(r: ReponseDialogue): Promise<string | null> {
    const a = this.avis;
    if (!a) return 'aucune question en attente';
    if (r.id !== a.id) return 'question périmée : une autre question est affichée';
    if (a.outil === OUTIL_PLAN) return this.repondrePlan(a, r);
    return this.repondreQuestion(a, r);
  }

  // Crochets : propres aux sessions pilotées dans tmux, le SDK n'en envoie pas.
  crochet(): ReponseCrochet {
    return {};
  }

  // Les mêmes outils de rythme que tmux, servis par le même serveur MCP (voir serveurRythme).
  rythme(outil: string, args: Record<string, unknown>): string {
    const effet = effetRythme(outil, args, this.etat.contexte);
    if (!effet) return `outil inconnu : ${outil}`;
    if (outil === 'etape_terminee') {
      this.bilan.etapeFaite();
      this.maj({ etapes: this.etat.etapes + 1 });
    } else if (outil === 'objectif_atteint') {
      this.bilan.marquerObjectif();
    } else {
      this.bilan.marquerQuestion();
    }
    this.emettre(effet.evenement);
    return effet.reponse;
  }

  private repondreQuestion(a: AvisEnAttente, r: ReponseDialogue): string | null {
    const courante = a.restantes[0];
    if (!courante) return 'aucune question en attente';
    const valeur = valeurReponse(courante, r);
    if ('erreur' in valeur) return valeur.erreur;
    a.reponses[courante.texte] = valeur.valeur;
    a.restantes.shift();
    if (a.restantes.length > 0) {
      this.publierQuestion(a);
      return null;
    }
    this.terminerAvis(a, { behavior: 'allow', updatedInput: { ...a.entree, answers: a.reponses } });
    return null;
  }

  private repondrePlan(a: AvisEnAttente, r: ReponseDialogue): string | null {
    const decision = decisionPlan(a.entree, r);
    if (!decision) return 'réponse hors du plan proposé';
    this.terminerAvis(a, decision);
    return null;
  }

  // Appelé par le SDK avant chaque outil : les questions deviennent des dialogues, le reste est autorisé.
  private autoriser(nom: string, entree: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    if (!OUTILS_AVIS.has(nom)) return Promise.resolve(autoriserSansQuestion(entree));
    const restantes = nom === OUTIL_PLAN ? [QUESTION_PLAN] : questionsDeAskUser(entree);
    if (!restantes) {
      return Promise.resolve({ behavior: 'deny', message: 'Questions illisibles : réponse impossible' });
    }
    return new Promise<PermissionResult>((decide) => {
      const a: AvisEnAttente = { outil: nom, entree, restantes, reponses: {}, id: '', decide };
      this.avis = a;
      signal.addEventListener('abort', () => this.refuser(a, 'Demande annulée', false), { once: true });
      this.publierQuestion(a);
    });
  }

  private publierQuestion(a: AvisEnAttente): void {
    const courante = a.restantes[0];
    if (!courante) return;
    a.id = randomUUID();
    this.emettre({ type: 'question', question: courante.texte });
    this.maj({ statut: 'question', dialogue: dialogueDeQuestion(a.id, courante) });
  }

  private terminerAvis(a: AvisEnAttente, decision: PermissionResult): void {
    this.avis = null;
    a.decide(decision);
    this.maj({ dialogue: null, statut: 'travail' });
  }

  private refuser(a: AvisEnAttente | null, message: string, interrompre: boolean): void {
    if (!a || this.avis !== a) return;
    this.terminerAvis(a, { behavior: 'deny', message, interrupt: interrompre });
  }

  private optionsDe(reprise: boolean): Options {
    return optionsSdk({
      identifiant: reprise ? (this.etat.claudeSessionId ?? this.etat.id) : this.etat.id,
      reprise,
      cwd: this.etat.cwd,
      consignes: this.p.consignes ?? '',
      modele: this.etat.modele === 'défaut' ? undefined : this.etat.modele,
      executable: this.env.executable,
      configDir: this.p.configDir,
      source: this.env.env ?? process.env,
      rythme: serveurRythme(this.etat.id, this.env.socket),
      canUseTool: (nom, entree, opts) => this.autoriser(nom, entree, opts.signal),
    });
  }

  private demarrer(reprise: boolean, message?: string): string | null {
    const fil = new FileAsynchrone<SDKUserMessage>();
    let liberer: () => void = () => undefined;
    const pret = new Promise<void>((r) => {
      liberer = () => r();
    });
    this.bilan = new BilanTour();
    try {
      const requete = this.fabrique({ prompt: messagesAvecConnecteurs(fil, pret), options: this.optionsDe(reprise) });
      this.aReprendre = true;
      this.requete = requete;
      this.fil = fil;
      void this.attendreConnecteurs(requete).then(() => liberer());
      void this.ecouter(requete, this.traduction.nouvelEtat());
      this.maj({ statut: message ? 'travail' : 'attente' });
      if (message) this.pousser(message);
      return null;
    } catch (erreur) {
      this.requete = null;
      this.fil = null;
      this.env.journal.error({ err: erreur, session: this.etat.id }, 'démarrage de la session SDK impossible');
      this.maj({ statut: 'erreur' });
      return `démarrage impossible : ${String(erreur)}`;
    }
  }

  // Un message poussé au SDK (Chris, relance, compaction, réveil) ouvre un tour que le bilan compte.
  private pousser(texte: string): void {
    if (!this.fil) return;
    this.fil.push(messageUtilisateur(texte));
    this.bilan.envoye();
  }

  // Le premier message n'attend que les connecteurs MCP de la config : le SDK ne les a pas tous à l'init.
  private async attendreConnecteurs(requete: RequeteSdk): Promise<void> {
    const fin = Date.now() + this.delaiMcp;
    try {
      while (Date.now() < fin) {
        const etats = await requete.mcpServerStatus();
        if (!etats.some((e) => e.status === 'pending')) return;
        await pause(this.periodeMcp);
      }
      this.env.journal.warn({ session: this.etat.id }, 'connecteurs MCP encore en attente : message envoyé quand même');
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id }, 'état des connecteurs MCP illisible');
    }
  }

  private async ecouter(requete: RequeteSdk, etatTraduction: EtatTraduction): Promise<void> {
    try {
      for await (const msg of requete) {
        if (this.requete !== requete) break;
        this.traiter(msg, etatTraduction);
      }
      this.arreterSansErreur(requete);
    } catch (erreur) {
      this.echouer(requete, erreur);
    }
  }

  private arreterSansErreur(requete: RequeteSdk): void {
    if (this.requete !== requete) return;
    this.aReprendre = false;
    this.libererRequete('Session terminée');
    this.maj({ statut: 'fermee' });
  }

  private echouer(requete: RequeteSdk, erreur: unknown): void {
    if (this.requete !== requete) return; // fermée volontairement : l'erreur qui suit n'est pas une panne
    this.env.journal.error({ err: erreur, session: this.etat.id }, 'requête SDK en échec');
    this.emettre({ type: 'erreur', message: String(erreur) });
    this.libererRequete('Session en erreur');
    this.maj({ statut: 'erreur' });
  }

  private libererRequete(message: string): void {
    const a = this.avis;
    this.refuser(a, message, true);
    this.requete = null;
    this.fil?.clore();
    this.fil = null;
  }

  private traiter(msg: SDKMessage, etatTraduction: EtatTraduction): void {
    const sortie = this.traduction.traduire(msg, etatTraduction);
    for (const evt of sortie.evenements) {
      this.constater(evt);
      this.emettre(evt);
    }
    this.bilan.observer(sortie.evenements, sortie.compaction === true);
    if (sortie.claudeSessionId && sortie.claudeSessionId !== this.etat.claudeSessionId) {
      this.maj({ claudeSessionId: sortie.claudeSessionId });
    }
    if (sortie.compaction) this.maj({ statut: 'compaction' });
    if (sortie.finDeTour) this.finDeTour(sortie.finDeTour);
  }

  private constater(evt: Evenement): void {
    if (evt.type !== 'compaction') return;
    this.maj({ compactions: this.etat.compactions + 1, contexte: { ...this.etat.contexte, tokens: evt.apres } });
  }

  // Fin de tour : l'état de la session, puis la suite donnée par la politique (comme le hook Stop d'une session tmux).
  private finDeTour(fin: NonNullable<SortieTraduction['finDeTour']>): void {
    const tokens = fin.contexte > 0 ? fin.contexte : this.etat.contexte.tokens;
    const suite = this.bilan.conclure({
      autonomie: this.etat.autonomie,
      aUnObjectif: this.etat.objectif !== null,
      contexte: tokens,
      maxTokens: this.etat.contexte.max,
    });
    const statut: StatutSession = suite.action === 'laisser' ? 'travail' : fin.erreur ? 'erreur' : 'attente';
    this.maj({ statut, contexte: { ...this.etat.contexte, tokens } });
    this.appliquerSuite(suite);
    void this.suiviNuit.tick();
  }

  private appliquerSuite(suite: Suite): void {
    if (suite.action === 'laisser' || suite.action === 'patienter') return;
    if (suite.action === 'arreter') {
      if (suite.note) this.emettre({ type: 'relance', raison: suite.note });
      if (suite.statut !== 'attente') this.maj({ statut: suite.statut });
      return;
    }
    if (suite.action === 'compacter') {
      this.lancerCompaction(suite.raison);
      return;
    }
    this.emettre({ type: 'relance', raison: suite.raison });
    this.maj({ statut: 'travail' });
    this.pousser(suite.texte);
  }

  private lancerCompaction(raison: string): void {
    this.bilan.compactionLancee();
    this.emettre({ type: 'relance', raison: `compaction : ${raison}` });
    this.maj({ statut: 'compaction' });
    this.pousser(CONSIGNE_COMPACTION);
  }

  // Le mode nuit réveille la session à l'arrêt : un message, comme celui de Chris.
  private async coller(texte: string): Promise<string | null> {
    if (!this.fil) return 'session fermée';
    this.pousser(texte);
    this.maj({ statut: 'travail' });
    return null;
  }

  private emettre(evt: Evenement): void {
    this.env.sortie.evenement(this.etat.id, evt);
  }

  private maj(champs: Partial<ResumeSession>): void {
    this.etat = { ...this.etat, ...champs, majLe: new Date().toISOString() };
    this.env.sortie.resume(this.etat);
  }
}
