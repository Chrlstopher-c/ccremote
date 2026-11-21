// Responsabilité : UNE session Claude Code pilotée par le Claude Agent SDK — façade de la session. Les modules
// session-sdk-*.ts tiennent la logique (processus, envoi, traduction, bilan, réglages, rattachement, panneau) sur un
// état partagé (session-sdk-noyau.ts) ; ce fichier en expose la surface inchangée au reste du poste.
import type {
  Options,
  SDKControlGetContextUsageResponse,
  SDKControlGetUsageResponse,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { ConnecteurSession, ContexteSession, DetailTacheSession, TacheSession } from '../../commun/panneau.ts';
import type { ResumeSession, ReponseDialogue } from '../../commun/session.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { RequeteRelais } from '../presentation/outils.ts';
import type { ToursSession } from '../modifications/tours.ts';
import type { Stockage } from '../presentation/stockage.ts';
import type { ModeleDate } from '../../commun/modele-date.ts';
import type { LimiteSdk } from '../../commun/comptes.ts';
import type { StylesSession } from '../../commun/configuration.ts';
import { binaireClaude } from './lanceur.ts';
import type { RequeteReglable } from './reglages-sdk.ts';
import type { ReponseCrochet, Reglage, SessionPoste, SortieSession } from './session-poste.ts';
import type { SessionPersistee } from './persistance.ts';
import type { EtatTraduction, SortieTraduction } from './traduction-sdk.ts';
import * as bilan from './session-sdk-bilan.ts';
import * as envoi from './session-sdk-envoi.ts';
import * as panneau from './session-sdk-panneau.ts';
import * as processus from './session-sdk-processus.ts';
import * as rattachement from './session-sdk-rattachement.ts';
import * as reglages from './session-sdk-reglages.ts';
import { creerNoyau, type NoyauSdk } from './session-sdk-noyau.ts';

// Ce que la session attend du SDK : une requête (flux de messages, interruption, fermeture).
export interface RequeteSdk extends AsyncIterable<SDKMessage>, RequeteReglable {
  interrupt(): Promise<unknown>;
  stopTask(tache: string): Promise<void>;
  close(): void;
  mcpServerStatus(): Promise<readonly { readonly name: string; readonly status: string }[]>;
  getContextUsage(opts: { readonly detail: 'summary' }): Promise<SDKControlGetContextUsageResponse>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(opts?: {
    readonly skipBehaviors?: boolean;
  }): Promise<SDKControlGetUsageResponse>;
  toggleMcpServer(nom: string, actif: boolean): Promise<void>;
  initializationResult(): Promise<{
    readonly output_style: string;
    readonly available_output_styles: readonly string[];
    readonly models?: readonly {
      readonly value: string;
      readonly resolvedModel?: string;
      readonly displayName: string;
    }[];
  }>;
  reloadOutputStyles(): Promise<unknown>;
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
  readonly limite?: (limite: LimiteSdk) => void; // fenêtre de quota vue dans le flux SDK (rate_limit_event)
  readonly tours?: ToursSession; // tours de la session : fichiers relevés avant édition, fin de tour
  readonly presentation?: {
    readonly stockage: Stockage;
    readonly racines: readonly string[];
    readonly api?: { readonly url: string; readonly jeton: string };
    readonly relais?: RequeteRelais; // outils de modules : le lien au relais
  }; // sans lui, pas d'outils `lanterne`
  readonly traduction?: TraductionSdk;
  readonly env?: Record<string, string | undefined>;
  readonly delaiMcpMs?: number;
  /** Transcript modifié depuis moins longtemps : sa queue est relue dès la première vue (0 : jamais, tests). */
  readonly relectureRecenteMs?: number;
  readonly periodeMcpMs?: number;
}

/** Le claude installé sur la machine, ou null (le SDK prend alors son binaire embarqué). */
export function trouverClaude(): string | null {
  return Bun.which(binaireClaude());
}

export class SessionSdk implements SessionPoste {
  private readonly n: NoyauSdk;

  constructor(p: SessionPersistee, env: EnvironnementSdk) {
    this.n = creerNoyau(p, env, (texte) => envoi.coller(this.n, texte));
  }

  get resume(): ResumeSession {
    return this.n.etat;
  }

  get persistee(): SessionPersistee {
    const n = this.n;
    return {
      ...n.p,
      resume: n.etat,
      transcript: null,
      position: 0,
      aReprendre: n.aReprendre,
      identifiants: [...n.identifiantsSdk],
    };
  }

  get identifiants(): readonly string[] {
    return this.n.identifiantsSdk;
  }

  get transcriptConnu(): boolean {
    return false;
  }

  get vivante(): boolean {
    return this.n.requete !== null;
  }

  definirTranscript(chemin: string): void {
    rattachement.definirTranscript(this.n, chemin);
  }

  rejouerHistorique(chemin: string, complet = false): number {
    return rattachement.rejouerHistorique(this.n, chemin, complet);
  }

  lire(): void {
    rattachement.lire(this.n);
  }

  liberer(): void {
    this.n.suivi.reinitialiser();
  }

  // Pas de pane tmux ni de terminal : le fil vient du SDK, la veille est celle du poste.
  rattacher(): void {}

  rattacherTerminal(vivant: boolean, enTour = false, modeleLu: ModeleDate | null = null): void {
    rattachement.rattacherTerminal(this.n, vivant, enTour, modeleLu);
  }

  recalerFiche(recalee: ResumeSession): void {
    rattachement.recalerFermee(this.n, recalee);
  }

  async releverEcran(): Promise<void> {}

  veillerNuit(maintenant?: number): Promise<void> {
    return this.n.suiviNuit.tick(maintenant);
  }

  async lancer(message: string, _modele?: string | null, pieces: readonly PieceJointe[] = []): Promise<string | null> {
    return envoi.lancer(this.n, message, _modele, pieces);
  }

  async envoyer(
    texte: string,
    pieces: readonly PieceJointe[] = [],
    auteur?: string,
    maintenant = false,
  ): Promise<string | null> {
    if (maintenant) return envoi.envoyerMaintenant(this.n, texte, pieces);
    return envoi.envoyer(this.n, texte, pieces, auteur);
  }

  async reprendre(message?: string): Promise<string | null> {
    return envoi.reprendre(this.n, message);
  }

  /** Le poste ne reprendra pas cette session à son démarrage : sa conversation est tenue par un autre processus. */
  renoncerReprise(): void {
    this.n.aReprendre = false;
  }

  reprendreApresRedemarrage(texte: string | null): string | null {
    return processus.reprendreApresRedemarrage(this.n, texte);
  }

  async interrompre(): Promise<string | null> {
    return processus.interrompre(this.n);
  }

  async compacter(): Promise<string | null> {
    return envoi.compacter(this.n);
  }

  // Arrête une tâche de fond (commande ou sous-agent) par son identifiant SDK.
  async arreterTache(tache: string): Promise<string | null> {
    return processus.arreterTache(this.n, tache);
  }

  // Rembobiner : la conversation repartira de l'entrée qui précède ce message (voir session-sdk-processus.ts).
  async rembobiner(messageId: string): Promise<string | null> {
    return processus.rembobiner(this.n, messageId);
  }

  recommencer(): void {
    processus.recommencer(this.n);
  }

  // Arrêt du poste : le processus Claude de la session s'arrête, la fiche ne change pas (reprise au redémarrage).
  arreterProcessus(): void {
    processus.arreterProcessus(this.n);
  }

  /** Le balayage voit la conversation tenue (ou non) par un processus Claude interactif hors Lanterne. */
  cederSiTenue(tenue: boolean): void {
    rattachement.cederSiTenue(this.n, tenue);
  }

  async fermer(): Promise<string | null> {
    return processus.fermer(this.n);
  }

  basculerAutonomie(active: boolean): void {
    bilan.basculerAutonomie(this.n, active);
  }

  async basculerNuit(active: boolean, objectif?: string): Promise<string | null> {
    return envoi.basculerNuit(this.n, active, objectif);
  }

  async repondre(r: ReponseDialogue): Promise<string | null> {
    return this.n.avis.repondre(r);
  }

  // Réglages en cours de session : appliqués à la requête vivante s'il y en a une, sinon au prochain démarrage.
  async reglerSession(r: Reglage): Promise<string | null> {
    return reglages.reglerSession(this.n, r);
  }

  // Usage du compte, panneau de session : lectures seules (voir session-sdk-panneau.ts).
  async usageSdk(): Promise<SDKControlGetUsageResponse | null> {
    return panneau.usageSdk(this.n);
  }

  async contexte(): Promise<ContexteSession | null> {
    return panneau.contexte(this.n);
  }

  async connecteurs(): Promise<ConnecteurSession[]> {
    return panneau.connecteurs(this.n);
  }

  async basculerConnecteur(nom: string, actif: boolean): Promise<string | null> {
    return panneau.basculerConnecteur(this.n, nom, actif);
  }

  async stylesVivants(): Promise<StylesSession | null> {
    return panneau.stylesVivants(this.n);
  }

  rechargerStyles(): Promise<void> {
    return panneau.rechargerStyles(this.n);
  }

  taches(): TacheSession[] {
    return panneau.taches(this.n);
  }

  tache(id: string): DetailTacheSession | null {
    return panneau.tache(this.n, id);
  }

  // Crochets : propres aux sessions pilotées dans tmux, le SDK n'en envoie pas.
  crochet(): ReponseCrochet {
    return {};
  }

  rythme(outil: string, args: Record<string, unknown>): string {
    return bilan.rythme(this.n, outil, args);
  }
}
