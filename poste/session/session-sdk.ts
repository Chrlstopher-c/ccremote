// Responsabilité : UNE session Claude Code pilotée par le Claude Agent SDK — une requête par session, nourrie par les
// messages de Chris ; ses événements traduits vers le fil ; ses questions (AskUserQuestion, ExitPlanMode) rendues à
// Chris comme dialogues ; les autres outils autorisés d'office ; à chaque fin de tour, la politique des sessions tmux
// (relance autonome, compaction, mode nuit), car le SDK n'a pas de hook Stop.
import { randomUUID } from 'node:crypto';
import {
  getSessionMessages,
  query as requeteParDefaut,
  type Options,
  type PermissionResult,
  type SDKControlGetContextUsageResponse,
  type SDKControlGetUsageResponse,
  type SDKMessage,
  type SDKUserMessage,
  type SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { ConnecteurSession, ContexteSession, DetailTacheSession, TacheSession } from '../../commun/panneau.ts';
import type { Evenement, ReponseDialogue, ResumeSession, StatutSession } from '../../commun/session.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { PiecesPreparees } from '../presentation/pieces.ts';
import { PresentationSession } from '../presentation/session-presentation.ts';
import { crochetEdition } from '../modifications/crochet-edition.ts';
import type { ToursSession } from '../modifications/tours.ts';
import type { Stockage } from '../presentation/stockage.ts';
import { BilanTour } from './bilan-tour.ts';
import { nomAffiche, nomLisibleModele } from './modele-affiche.ts';
import { pointDeRembobinage } from './rembobinage.ts';
import { contexteDe } from './contexte-sdk.ts';
import { AvisSdk } from './avis-sdk.ts';
import {
  attendreConnecteurs,
  type EtatMcp,
  FileAsynchrone,
  messageUtilisateur,
  messagesAvecConnecteurs,
} from './file-messages-sdk.ts';
import { binaireClaude, serveurRythme } from './lanceur.ts';
import { basculerNuitClaude, lireNuit, TEXTE_ACTIVATION, TEXTE_RETOUR } from './nuit.ts';
import { optionsSdk } from './options-sdk.ts';
import type { SessionPersistee } from './persistance.ts';
import { CONSIGNE_COMPACTION } from './politique-compaction.ts';
import { RAISON_REDEMARRAGE } from './reprise.ts';
import { lireHistorique, stockeurImages } from './historique.ts';
import {
  appliquerReglage,
  basculerMode,
  champsReglage,
  lireModes,
  type ReglageMode,
  type RequeteReglable,
} from './reglages-sdk.ts';
import { etatRapideLu, rapideLu, ultracodeDefaut, ultracodeLu } from './modes-sdk.ts';
import { effetRythme } from './rythme.ts';
import type { ReponseCrochet, Reglage, SessionPoste, SortieSession } from './session-poste.ts';
import type { Suite } from './suite-du-tour.ts';
import { SuiviNuit } from './suivi-nuit.ts';
import { OUTILS_INTERDITS_ANNEXE } from './annexe.ts';
import { ReglagesVivants } from './session-sdk-vivante.ts';
import type { StylesSession } from '../../commun/configuration.ts';
import { RegistreTaches } from './taches-sdk.ts';
import { type EtatTraduction, nouvelEtatTraduction, type SortieTraduction, traduireSdk } from './traduction-sdk.ts';

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
    readonly models?: readonly { readonly value: string; readonly resolvedModel?: string; readonly displayName: string }[];
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
  readonly tours?: ToursSession; // tours de la session : fichiers relevés avant édition, fin de tour
  readonly presentation?: {
    readonly stockage: Stockage;
    readonly racines: readonly string[];
    readonly api?: { readonly url: string; readonly jeton: string };
  }; // sans lui, pas d'outils `lanterne`
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
  private readonly presentation: PresentationSession | null;
  private readonly registreTaches = new RegistreTaches();
  private readonly reglagesVivants: ReglagesVivants;
  private aReprendre: boolean; // à reprendre au démarrage du poste (voir persistance.ts)
  private historiqueEmis = false; // l'historique du transcript n'est envoyé qu'à l'ouverture de la fiche
  // Rembobinage en attente : la prochaine reprise part de cette entrée du transcript (resumeSessionAt).
  private pointReprise: string | null = null;
  // Conversation recommencée après le rembobinage du premier message : son identifiant SDK (sans reprise).
  private identifiantNeuf: string | null = null;
  // Identifiants SDK de cette fiche (anciens et courant), persistés : leurs transcripts ne sont jamais adoptés à part.
  private readonly identifiantsSdk: string[];
  // Chris a interrompu le tour en cours : le SDK coupe alors le flux par une erreur, qui n'est pas une panne.
  private interrompuParChris = false;

  constructor(
    private readonly p: SessionPersistee,
    private readonly env: EnvironnementSdk,
  ) {
    // Au démarrage du poste aucune requête ne vit : une session persistée est reprenable, pas active.
    this.aReprendre = p.aReprendre;
    this.identifiantsSdk = [...(p.identifiants ?? [])];
    this.avis = new AvisSdk({ emettre: (evt) => this.emettre(evt), maj: (champs) => this.maj(champs) });
    const statut = p.aReprendre ? p.resume.statut : 'fermee';
    this.etat = { ...p.resume, statut, dialogue: null, tmux: null, attachee: false, moteur: 'sdk' };
    this.fabrique = env.requete ?? requeteParDefaut;
    this.reglagesVivants = new ReglagesVivants(() => this.requete, env.journal, p.resume.id);
    this.traduction = env.traduction ?? TRADUCTION_PAR_DEFAUT;
    this.delaiMcp = env.delaiMcpMs ?? DELAI_MCP_MS;
    this.periodeMcp = env.periodeMcpMs ?? PERIODE_MCP_MS;
    const pres = env.presentation;
    this.presentation = pres
      ? new PresentationSession({
          sessionId: p.resume.id,
          cwd: p.resume.cwd,
          racines: pres.racines,
          stockage: pres.stockage,
          emettre: (evt) => this.emettre(evt),
          journal: env.journal,
          ...(pres.api ? { api: pres.api } : {}),
        })
      : null;
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
    return {
      ...this.p,
      resume: this.etat,
      transcript: null,
      position: 0,
      aReprendre: this.aReprendre,
      identifiants: [...this.identifiantsSdk],
    };
  }

  get identifiants(): readonly string[] {
    return this.identifiantsSdk;
  }

  private memoriser(id: string | null): void {
    if (id && !this.identifiantsSdk.includes(id)) this.identifiantsSdk.push(id);
  }

  get transcriptConnu(): boolean {
    return false;
  }

  get vivante(): boolean {
    return this.requete !== null;
  }

  // Session découverte ou adoptée : son historique entier part au relais, en un lot, une seule fois par fiche.
  // Ensuite le fil vient du SDK ; une session SDK ne relit pas son transcript.
  definirTranscript(chemin: string): void {
    if (this.historiqueEmis) return;
    this.rejouerHistorique(chemin);
  }

  // Relit tout le transcript vers le relais, en lots ; le fil du relais ne reçoit une relecture que sur un fil vide.
  rejouerHistorique(chemin: string): number {
    this.historiqueEmis = true;
    const stockage = this.env.presentation?.stockage;
    const images = stockage ? stockeurImages(stockage, this.etat.id, this.env.journal) : undefined;
    const evenements = lireHistorique(chemin, this.env.journal, images);
    this.env.sortie.historique?.(this.etat.id, evenements);
    return evenements.length;
  }
  lire(): void {}

  // Pas de pane tmux ni de terminal : le fil vient du SDK, la veille est celle du poste.
  rattacher(): void {}
  rattacherTerminal(): void {}
  async releverEcran(): Promise<void> {}

  veillerNuit(maintenant?: number): Promise<void> {
    return this.suiviNuit.tick(maintenant);
  }

  // Les messages de Chris entrent dans le fil tout de suite : le SDK ne les renvoie pas (contrairement au transcript
  // relu par les sessions tmux).
  // Pièces du premier message : préparées avant tout démarrage (une pièce refusée ne lance rien), comme `envoyer`.
  async lancer(message: string, _modele?: string | null, pieces: readonly PieceJointe[] = []): Promise<string | null> {
    const jointes =
      pieces.length > 0
        ? (this.presentation?.pieces(pieces) ?? 'pièces jointes non prises en charge par cette session')
        : null;
    if (typeof jointes === 'string') return jointes;
    const uuid = randomUUID();
    this.emettre({ type: 'message', texte: message, uuid });
    jointes?.evenements.forEach((evt) => this.emettre(evt));
    return this.demarrer(false, message + (jointes?.complement ?? ''), uuid, jointes?.blocs);
  }

  // Pièces jointes : vérifiées avant le message (une pièce refusée n'envoie rien) ; leurs événements suivent le message.
  async envoyer(texte: string, pieces: readonly PieceJointe[] = []): Promise<string | null> {
    if (!this.fil && !this.etat.claudeSessionId && this.identifiantNeuf) return this.lancer(texte, null, pieces);
    if (!this.fil) return pieces.length > 0 ? 'session fermée : la reprendre avant d’y joindre des fichiers' : this.reprendre(texte);
    const jointes = pieces.length > 0 ? (this.presentation?.pieces(pieces) ?? 'pièces jointes non prises en charge par cette session') : null;
    if (typeof jointes === 'string') return jointes;
    const uuid = randomUUID();
    this.emettre({ type: 'message', texte, uuid });
    jointes?.evenements.forEach((evt) => this.emettre(evt));
    this.bilan.messageDeChris();
    this.pousser(texte + (jointes?.complement ?? ''), jointes?.blocs, uuid);
    if (this.etat.statut !== 'compaction') this.maj({ statut: 'travail' });
    return null;
  }

  async reprendre(message?: string): Promise<string | null> {
    if (this.fil) return message ? this.envoyer(message) : null;
    if (!this.etat.claudeSessionId) return 'conversation inconnue : impossible de la reprendre';
    const uuid = message ? randomUUID() : undefined;
    if (message) this.emettre({ type: 'message', texte: message, uuid });
    return this.demarrer(true, message, uuid);
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

  // Rembobiner : la conversation repartira de l'entrée qui précède ce message ; le message et la suite sont retirés
  // de la reprise. La session se ferme ici, la reprise part au prochain message de Chris.
  async rembobiner(messageId: string): Promise<string | null> {
    const id = this.etat.claudeSessionId;
    if (!id) return 'conversation inconnue : rien à rembobiner';
    let messages: SessionMessage[];
    try {
      messages = await getSessionMessages(id, { dir: this.etat.cwd });
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id }, 'lecture du transcript impossible');
      return `lecture du transcript impossible : ${String(erreur)}`;
    }
    const point = pointDeRembobinage(messages, messageId);
    if (point.tag === 'absent') return point.raison;
    const refus = await this.fermer();
    if (refus) return refus;
    if (point.tag === 'premier') this.recommencer();
    else this.pointReprise = point.uuid;
    return null;
  }

  // Premier message rembobiné : rien ne précède, la conversation repart de zéro (nouvel identifiant SDK, sans reprise).
  recommencer(): void {
    this.identifiantNeuf = randomUUID();
    this.memoriser(this.etat.claudeSessionId);
    this.memoriser(this.identifiantNeuf);
    this.pointReprise = null;
    this.maj({ claudeSessionId: null });
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
    if (r.kind === 'rapide' || r.kind === 'ultracode') return this.reglerMode(r);
    const requete = this.requete;
    if (requete && r.kind !== 'renommer') {
      try {
        await appliquerReglage(requete, r, this.etat.ultracode?.demande === true);
      } catch (erreur) {
        this.env.journal.warn({ err: erreur, session: this.etat.id, reglage: r.kind }, 'réglage refusé par le SDK');
        return `réglage impossible : ${String(erreur)}`;
      }
    }
    this.maj(champsReglage(r));
    if (requete && r.kind === 'modele') {
      void this.nommerModele(requete);
      void this.relever(requete);
    }
    return null;
  }

  // Mode rapide et Ultracode : la requête vivante reçoit la bascule, la fiche reçoit ce que le SDK en fait.
  private async reglerMode(r: ReglageMode): Promise<string | null> {
    try {
      this.maj(await basculerMode(this.requete, r, this.etat, this.env.journal));
      return null;
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id, reglage: r.kind }, 'réglage refusé par le SDK');
      return `réglage impossible : ${String(erreur)}`;
    }
  }

  // Compatibilité du mode rapide et dispo d'Ultracode : relevées à l'initialisation, puis après un modèle.
  private async relever(requete: RequeteSdk): Promise<void> {
    const lu = await lireModes(requete, this.etat.modele, this.env.journal, this.etat.id);
    if (this.requete !== requete) return;
    this.maj({
      rapide: rapideLu(this.etat.rapide, lu.rapide, lu.compatible),
      ultracode: ultracodeLu(this.etat.ultracode ?? ultracodeDefaut(), lu.reglages),
    });
  }

  // Nom affiché du modèle, lu dans la liste du SDK pour le compte ; absent de la liste : pas de nom (Lanterne dérive).
  private async nommerModele(requete: RequeteSdk): Promise<void> {
    try {
      const init = await requete.initializationResult();
      const nom = nomAffiche(this.etat.modele, init.models);
      if (nom !== (this.etat.modeleNom ?? null)) this.maj({ modeleNom: nom });
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id }, 'nom du modèle non lu dans la requête');
    }
  }

  // Usage du compte (abonnement, contributeurs) : lecture seule, comme `contexte()` ; sans requête ouverte, null.
  async usageSdk(): Promise<SDKControlGetUsageResponse | null> {
    const requete = this.requete;
    if (!requete) return null;
    try {
      return await requete.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id }, 'usage du compte non lu dans la requête');
      return null;
    }
  }

  // Panneau de session : lectures seules. Le contexte n'existe que pendant une requête ouverte (null sinon).
  async contexte(): Promise<ContexteSession | null> {
    const requete = this.requete;
    if (!requete) return null;
    return contexteDe(await requete.getContextUsage({ detail: 'summary' }));
  }

  // Au repos, le dernier relevé gardé dans la fiche (il survit au redémarrage du poste) ; vivante, un relevé neuf.
  async connecteurs(): Promise<ConnecteurSession[]> {
    const requete = this.requete;
    if (!requete) return this.etat.connecteurs ?? [];
    return this.releverConnecteurs(requete);
  }

  // Connecteurs MCP, styles de sortie : réglés dans la requête vivante (voir session-sdk-vivante.ts).
  async basculerConnecteur(nom: string, actif: boolean): Promise<string | null> {
    const requete = this.requete;
    const erreur = await this.reglagesVivants.connecteur(nom, actif);
    if (!erreur && requete) void this.releverConnecteurs(requete);
    return erreur;
  }

  private async releverConnecteurs(requete: RequeteSdk): Promise<ConnecteurSession[]> {
    try {
      this.memoriserEtats(requete, await requete.mcpServerStatus());
    } catch (erreur) {
      this.env.journal.warn({ err: erreur, session: this.etat.id }, 'connecteurs MCP non relevés');
    }
    return this.etat.connecteurs ?? [];
  }

  private memoriserEtats(requete: RequeteSdk, etats: readonly EtatMcp[]): void {
    if (this.requete !== requete) return;
    const liste = etats.map((etat) => ({ nom: etat.name, statut: this.reglagesVivants.statut(etat.name, etat.status) }));
    if (JSON.stringify(liste) !== JSON.stringify(this.etat.connecteurs ?? [])) this.maj({ connecteurs: liste });
  }

  // `initializationResult` garde le style du lancement : un style changé en cours de session vient de la fiche.
  async stylesVivants(): Promise<StylesSession | null> {
    const lus = await this.reglagesVivants.styles();
    return lus && this.etat.style_sortie ? { ...lus, actuel: this.etat.style_sortie } : lus;
  }

  rechargerStyles(): Promise<void> {
    return this.reglagesVivants.recharger();
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
      identifiant: reprise ? (this.etat.claudeSessionId ?? this.etat.id) : (this.identifiantNeuf ?? this.etat.id),
      reprise,
      reprisePoint: this.pointReprise,
      cwd: this.etat.cwd,
      consignes: this.p.consignes ?? '',
      modele: this.etat.modele === 'défaut' ? undefined : this.etat.modele,
      rapide: this.etat.rapide?.demande === true,
      ultracode: this.etat.ultracode?.demande === true,
      executable: this.env.executable,
      configDir: this.p.configDir,
      source: this.env.env ?? process.env,
      rythme: serveurRythme(this.etat.id, this.env.socket),
      outils: this.presentation?.serveur(),
      mode: this.etat.mode ?? 'bypassPermissions',
      effort: this.etat.effort ?? null,
      style: this.etat.style_sortie ?? null,
      bacASable: this.etat.bac_a_sable,
      interdits: this.etat.annexe_de ? OUTILS_INTERDITS_ANNEXE : undefined,
      hooks: this.crochets(),
      canUseTool: (nom, entree, opts) =>
        this.avis.autoriser(nom, entree, opts.suggestions ?? [], opts.signal, (this.etat.mode ?? 'bypassPermissions') === 'bypassPermissions'),
    });
  }

  // Relève le contenu d'un fichier avant que l'outil d'édition le modifie (sans jamais décider de l'outil).
  private crochets(): Options['hooks'] {
    const tours = this.env.tours;
    if (!tours) return undefined;
    return { PreToolUse: [crochetEdition(this.etat.cwd, (absolu) => tours.noterAvant(absolu), this.env.journal)] };
  }

  private demarrer(
    reprise: boolean,
    message?: string,
    uuid?: SDKUserMessage['uuid'],
    blocs?: PiecesPreparees['blocs'],
  ): string | null {
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
      this.pointReprise = null;
      this.fil = fil;
      void this.attendreConnecteurs(requete).then(() => liberer());
      void this.ecouter(requete, this.traduction.nouvelEtat());
      void this.nommerModele(requete);
      void this.relever(requete);
      this.maj({ statut: message ? 'travail' : 'attente' });
      if (message) this.pousser(message, blocs, uuid);
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
  private pousser(texte: string, blocs?: PiecesPreparees['blocs'], uuid?: SDKUserMessage['uuid']): void {
    this.interrompuParChris = false;
    if (!this.fil) return;
    this.fil.push(messageUtilisateur(texte, blocs, uuid));
    this.bilan.envoye();
  }

  private attendreConnecteurs(requete: RequeteSdk): Promise<void> {
    return attendreConnecteurs(
      requete,
      { delaiMs: this.delaiMcp, periodeMs: this.periodeMcp, session: this.etat.id },
      this.env.journal,
      (etats) => this.memoriserEtats(requete, etats),
    );
  }

  private async ecouter(requete: RequeteSdk, etatTraduction: EtatTraduction): Promise<void> {
    try {
      for await (const msg of requete) {
        if (this.requete !== requete) break;
        this.nommerModeleVu(msg);
        this.traiter(msg, etatTraduction);
      }
      this.arreterSansErreur(requete);
    } catch (erreur) {
      this.echouer(requete, erreur);
    }
  }

  // Session sur le modèle par défaut du compte : le nom réel est celui du dernier message assistant.
  private nommerModeleVu(msg: SDKMessage): void {
    if (msg.type !== 'assistant' || this.etat.modele !== 'défaut') return;
    const modele: unknown = msg.message.model;
    if (typeof modele !== 'string' || modele === '' || modele.startsWith('<')) return;
    const nom = nomLisibleModele(modele);
    if (nom !== (this.etat.modeleNom ?? null)) this.maj({ modeleNom: nom });
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

  // Fichiers touchés par le tour, juste avant `tour_fini` (ou à la fin d'un tour interrompu, sans `tour_fini`).
  private clorTour(): void {
    const tour = this.env.tours?.finirTour();
    if (tour) this.emettre({ type: 'fichiers_tour', tour: tour.tour, fichiers: tour.fichiers });
  }

  private libererRequete(message: string): void {
    this.clorTour();
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
      if (evt.type === 'tour_fini') this.clorTour();
      this.constater(evt);
      this.emettre(evt);
    }
    this.bilan.observer(evenements, sortie.compaction === true);
    this.presentation?.depuisMessage(msg);
    const modeRapide = etatRapideLu(msg);
    if (modeRapide) this.maj({ rapide: rapideLu(this.etat.rapide, modeRapide) });
    if (sortie.claudeSessionId && sortie.claudeSessionId !== this.etat.claudeSessionId) {
      this.memoriser(this.etat.claudeSessionId);
      this.memoriser(sortie.claudeSessionId);
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
