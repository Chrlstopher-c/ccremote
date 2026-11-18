// Responsabilité : UNE session Claude Code pilotée par le Claude Agent SDK — une requête par session, nourrie par les
// messages de Chris ; ses événements traduits vers le fil ; ses questions (AskUserQuestion, ExitPlanMode) rendues à
// Chris comme dialogues ; les autres outils autorisés d'office ; à chaque fin de tour, la politique des sessions tmux
// (relance autonome, compaction, mode nuit), car le SDK n'a pas de hook Stop.
import { randomUUID } from 'node:crypto';
import {
  query as requeteParDefaut,
  type Options,
  type PermissionResult,
  type SDKControlGetContextUsageResponse,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { ConnecteurSession, ContexteSession, DetailTacheSession, TacheSession } from '../../commun/panneau.ts';
import type { Evenement, ReponseDialogue, ResumeSession, StatutSession } from '../../commun/session.ts';
import { BilanTour } from './bilan-tour.ts';
import { contexteDe } from './contexte-sdk.ts';
import { AvisSdk } from './avis-sdk.ts';
import { FileAsynchrone, messageUtilisateur, messagesAvecConnecteurs } from './file-messages-sdk.ts';
import { binaireClaude, serveurRythme } from './lanceur.ts';
import { basculerNuitClaude, lireNuit, TEXTE_ACTIVATION, TEXTE_RETOUR } from './nuit.ts';
import { optionsSdk } from './options-sdk.ts';
import type { SessionPersistee } from './persistance.ts';
import { CONSIGNE_COMPACTION } from './politique-compaction.ts';
import { RAISON_REDEMARRAGE } from './reprise.ts';
import { champsReglage, appliquerReglage, type RequeteReglable } from './reglages-sdk.ts';
import { effetRythme } from './rythme.ts';
import type { ReponseCrochet, Reglage, SessionPoste, SortieSession } from './session-poste.ts';
import type { Suite } from './suite-du-tour.ts';
import { SuiviNuit } from './suivi-nuit.ts';
import { RegistreTaches } from './taches-sdk.ts';
import { type EtatTraduction, nouvelEtatTraduction, type SortieTraduction, traduireSdk } from './traduction-sdk.ts';

// Ce que la session attend du SDK : une requête (flux de messages, interruption, fermeture).
export interface RequeteSdk extends AsyncIterable<SDKMessage>, RequeteReglable {
  interrupt(): Promise<unknown>;
  stopTask(tache: string): Promise<void>;
  close(): void;
  mcpServerStatus(): Promise<readonly { readonly name: string; readonly status: string }[]>;
  getContextUsage(opts: { readonly detail: 'summary' }): Promise<SDKControlGetContextUsageResponse>;
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

export class SessionSdk implements SessionPoste {
  private etat: ResumeSession;
  private requete: RequeteSdk | null = null;
  private fil: FileAsynchrone<SDKUserMessage> | null = null;
  private readonly avis: AvisSdk;
  private bilan = new BilanTour();
  private readonly fabrique: FabriqueRequete;
  private readonly traduction: TraductionSdk;
  private readonly delaiMcp: number;
  private readonly periodeMcp: number;
  private readonly suiviNuit: SuiviNuit;
  private readonly registreTaches = new RegistreTaches();
  private aReprendre: boolean; // à reprendre au démarrage du poste (voir persistance.ts)
  // Chris a interrompu le tour en cours : le SDK coupe alors le flux par une erreur, qui n'est pas une panne.
  private interrompuParChris = false;

  constructor(
    private readonly p: SessionPersistee,
    private readonly env: EnvironnementSdk,
  ) {
    // Au démarrage du poste aucune requête ne vit : une session persistée est reprenable, pas active.
    this.aReprendre = p.aReprendre;
    this.avis = new AvisSdk({ emettre: (evt) => this.emettre(evt), maj: (champs) => this.maj(champs) });
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
    this.interrompuParChris = true;
    this.avis.refuserTous(TEXTE_INTERRUPTION, true);
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

  // Arrête une tâche de fond (commande ou sous-agent) par son identifiant SDK ; son état revient par les messages du SDK.
  async arreterTache(tache: string): Promise<string | null> {
    const requete = this.requete;
    if (!requete) return 'session fermée';
    try {
      await requete.stopTask(tache);
      return null;
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id, tache }, 'arrêt de tâche refusé par le SDK');
      return `arrêt impossible : ${String(erreur)}`;
    }
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
    return this.avis.repondre(r);
  }

  // Réglages en cours de session : appliqués à la requête vivante s'il y en a une, sinon au prochain démarrage.
  async reglerSession(r: Reglage): Promise<string | null> {
    const requete = this.requete;
    if (requete && r.kind !== 'renommer') {
      try {
        await appliquerReglage(requete, r);
      } catch (erreur) {
        this.env.journal.warn({ err: erreur, session: this.etat.id, reglage: r.kind }, 'réglage refusé par le SDK');
        return `réglage impossible : ${String(erreur)}`;
      }
    }
    this.maj(champsReglage(r));
    return null;
  }

  // Panneau de session : lectures seules. Le contexte n'existe que pendant une requête ouverte (null sinon).
  async contexte(): Promise<ContexteSession | null> {
    const requete = this.requete;
    if (!requete) return null;
    return contexteDe(await requete.getContextUsage({ detail: 'summary' }));
  }

  async connecteurs(): Promise<ConnecteurSession[]> {
    const requete = this.requete;
    if (!requete) return [];
    return (await requete.mcpServerStatus()).map((etat) => ({ nom: etat.name, statut: etat.status }));
  }

  taches(): TacheSession[] {
    return this.registreTaches.liste();
  }

  tache(id: string): DetailTacheSession | null {
    return this.registreTaches.detail(id);
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
      mode: this.etat.mode ?? 'bypassPermissions',
      effort: this.etat.effort ?? null,
      canUseTool: (nom, entree, opts) =>
        this.avis.autoriser(nom, entree, opts.suggestions ?? [], opts.signal, (this.etat.mode ?? 'bypassPermissions') === 'bypassPermissions'),
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
    this.interrompuParChris = false;
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
    if (this.interrompuParChris) {
      this.env.journal.info({ session: this.etat.id }, 'flux SDK coupé après interruption demandée par Chris');
      this.libererRequete('Interrompue par Chris');
      this.maj({ statut: 'attente' });
      return;
    }
    this.env.journal.error({ err: erreur, session: this.etat.id }, 'requête SDK en échec');
    this.emettre({ type: 'erreur', message: String(erreur) });
    this.libererRequete('Session en erreur');
    this.maj({ statut: 'erreur' });
  }

  private libererRequete(message: string): void {
    this.avis.refuserTous(message, true);
    this.requete = null;
    this.fil?.clore();
    this.fil = null;
  }

  private traiter(msg: SDKMessage, etatTraduction: EtatTraduction): void {
    this.registreTaches.observer(msg);
    const sortie = this.traduction.traduire(msg, etatTraduction);
    // Après une interruption de Chris, le SDK rend son résultat en erreur : ce n'est pas une panne du tour.
    const evenements = sortie.evenements.filter((evt) => evt.type !== 'erreur' || !this.interrompuParChris);
    for (const evt of evenements) {
      this.constater(evt);
      this.emettre(evt);
    }
    this.bilan.observer(evenements, sortie.compaction === true);
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
    const panne = fin.erreur && !this.interrompuParChris;
    const statut: StatutSession = suite.action === 'laisser' ? 'travail' : panne ? 'erreur' : 'attente';
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
