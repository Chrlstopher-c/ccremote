/**
 * Responsabilité : formes de données du registre d'état (E.1.1, E.1.3).
 * Aucune I/O ici — uniquement les types du domaine « registre ».
 */

import type { AccesMandat } from '../../shared/acces-mandat.ts';

/**
 * États rapportés par le worker (Découverte 2, E.1.1). Autorité : le PC.
 * ☠ Ne JAMAIS fusionner avec EtatHarness dans un seul champ (panne #30).
 */
export type EtatSdk = 'idle' | 'running' | 'requires_action';

/**
 * États décidés par le control plane (E.1.1). Autorité : le Pi.
 * `planifiee` / `en_cours` / `annulee` complètent la liste de E.1.1 : le champ
 * est NOT NULL et doit couvrir tout le cycle de vie, y compris avant spawn.
 * `en_cours` ≠ `running` : le Pi considère la mission dispatchée et vivante,
 * le SDK oscille running/idle à chaque tour.
 */
export type EtatHarness =
  | 'planifiee'
  | 'en_cours'
  | 'en_pause'
  | 'attente_machine'
  | 'echec_definitif'
  | 'terminee'
  | 'annulee';

/** États harness considérés comme occupant le projet (H-56 : une seule mission active par projet). */
export const ETATS_HARNESS_ACTIFS: readonly EtatHarness[] = [
  'planifiee',
  'en_cours',
  'en_pause',
  'attente_machine',
] as const;

/** États harness terminaux — `terminee` est le cas NOMINAL (F2.0.1). */
export const ETATS_HARNESS_TERMINAUX: readonly EtatHarness[] = [
  'echec_definitif',
  'terminee',
  'annulee',
] as const;

export type OrigineTransition = 'sdk' | 'harness';

/** Fenêtres de rate limit exposées par SDKRateLimitInfo (H-54). Chaîne libre : la liste bouge. */
export type TypeFenetreQuota = string;

export type StatutQuota = 'allowed' | 'allowed_warning' | 'rejected';

/**
 * Un lot = l'ensemble des missions issues d'une même intention utilisateur (F2.1.4).
 * En v1 un lot ne porte qu'une mission (H-56) ; la structure est conservée pour
 * le parallélisme futur — l'ajouter après coup serait une migration.
 */
export interface Lot {
  readonly id: string;
  readonly intention: string;
  readonly origine: string | null;
  readonly creeA: number;
  readonly closA: number | null;
}

export interface CreationLot {
  readonly id: string;
  readonly intention: string;
  readonly origine?: string | null;
}

/** Compte Claude Code isolé par CLAUDE_CONFIG_DIR (H-53). */
export interface Compte {
  readonly id: string;
  readonly configDir: string;
  readonly email: string | null;
  readonly organisation: string | null;
  readonly typeAbonnement: string | null;
  readonly fournisseurApi: string | null;
  readonly actif: boolean;
  readonly creeA: number;
  readonly majA: number;
}

export interface CreationCompte {
  readonly id: string;
  readonly configDir: string;
  readonly email?: string | null;
  readonly organisation?: string | null;
  readonly typeAbonnement?: string | null;
  readonly fournisseurApi?: string | null;
  readonly actif?: boolean;
}

/** Instantané de quota par (compte, fenêtre), dernier-gagne (H-54). */
export interface Quota {
  readonly compteId: string;
  readonly typeFenetre: TypeFenetreQuota;
  readonly statut: StatutQuota;
  readonly resetA: number | null;
  readonly utilisation: number | null;
  readonly statutOverage: string | null;
  readonly utiliseOverage: boolean | null;
  readonly seuilDepasse: string | null;
  readonly observeA: number;
}

export interface RelevéQuota {
  readonly compteId: string;
  readonly typeFenetre: TypeFenetreQuota;
  readonly statut: StatutQuota;
  readonly resetA?: number | null;
  readonly utilisation?: number | null;
  readonly statutOverage?: string | null;
  readonly utiliseOverage?: boolean | null;
  readonly seuilDepasse?: string | null;
  readonly observeA?: number;
}

/** Mission instanciée, jetable, à but borné (F2.0.1). */
/**
 * Un poste de la ventilation du contexte. `☠` `differe` marque un poste ANNONCÉ
 * mais PAS chargé : mesuré le 23/07, les postes différés (~36 K d'outils MCP et
 * système) ne comptent PAS dans le total. Les additionner ferait dépasser le
 * total réel de plus du double.
 */
export interface PosteContexteMission {
  readonly nom: string;
  readonly tokens: number;
  readonly differe: boolean;
}

/** Nature d'une activité au fil d'une mission — voir migration 8. */
export type NatureActiviteMission = 'texte' | 'reflexion' | 'outil';

export interface ActiviteMission {
  readonly texte: string;
  readonly survenuA: number;
  readonly type: NatureActiviteMission;
  /** Nom de l'outil, renseigné seulement pour `type: 'outil'`. */
  readonly outil: string | null;
}

/**
 * Un sous-agent d'une mission, tel que le disque du PC le connaît (migration 10).
 *
 * `☠` La liste vient du TRANSCRIT, jamais du flux temps réel : celui-ci est
 * mesuré non déterministe (H-72.4, 0 à 4 lignes livrées sur 5 sous-agents
 * réellement lancés). Un sous-agent existe parce qu'il a un fichier, pas parce
 * qu'une ligne est arrivée.
 */
/** Une ligne du fil d'un sous-agent (migration 11). */
export interface ActiviteSousAgentMission {
  readonly texte: string;
  readonly survenuA: number;
  readonly type: NatureActiviteMission;
  readonly outil: string | null;
}

export interface SousAgentMission {
  readonly agentId: string;
  /** `general-purpose`, `Explore`… tel qu'écrit par le CLI. `null` si meta illisible. */
  readonly type: string | null;
  readonly description: string | null;
  /**
   * `parent_tool_use_id` côté flux — le pont flux ⟷ store, trouvé dans le
   * `agent-<id>.meta.json` écrit par le CLI (23/07). Absent des types publics
   * du SDK, d'où sa réputation d'introuvable.
   */
  readonly toolUseId: string | null;
  readonly profondeur: number;
  readonly statut: 'actif' | 'termine';
  readonly derniereAction: string | null;
  readonly majA: number;
}

export interface Mission {
  readonly id: string;
  readonly lotId: string;
  readonly nom: string;
  readonly projet: string;
  readonly worktree: string | null;
  readonly branche: string | null;
  readonly sessionId: string | null;
  readonly compteId: string;
  readonly mandat: string | null;
  readonly critereArret: string | null;
  readonly modeleDemande: string | null;
  readonly modeleResolu: string | null;
  /** Autorité : le worker (PC). */
  readonly etatSdk: EtatSdk | null;
  readonly etatSdkMajA: number | null;
  /** Autorité : le control plane (Pi). */
  readonly etatHarness: EtatHarness;
  readonly etatHarnessMajA: number;
  readonly epoch: number;
  readonly highWaterMark: number;
  readonly budgetMaxUsd: number | null;
  readonly budgetConsommeUsd: number;
  readonly contexteTokensUtilises: number | null;
  readonly contexteTokensMax: number | null;
  /**
   * Ventilation du contexte par poste, mesurée côté PC. `☠` Un pourcentage seul
   * ne dit pas s'il s'agit du socle incompressible ou de travail réel — c'est
   * pourtant la distinction sur laquelle on décide d'un atterrissage.
   */
  readonly contexteVentilation: readonly PosteContexteMission[] | null;
  readonly compteurRelances: number;
  readonly derniereRaisonTerminale: string | null;
  /**
   * Conversation orchestrateur d'où vient cette équipe (migration 14) — donc où
   * renvoyer ce qui la concerne. `null` quand elle naît hors conversation
   * (restauration, test, mandat-cadre) : ce n'est pas une anomalie, seulement une
   * notification sans destinataire à réveiller.
   */
  readonly conversationId: string | null;
  readonly creeA: number;
  readonly demarreeA: number | null;
  readonly termineeA: number | null;
}

export interface CreationMission {
  readonly id: string;
  readonly lotId: string;
  readonly nom: string;
  readonly projet: string;
  readonly compteId: string;
  readonly worktree?: string | null;
  readonly branche?: string | null;
  readonly sessionId?: string | null;
  readonly mandat?: string | null;
  readonly critereArret?: string | null;
  readonly modeleDemande?: string | null;
  readonly modeleResolu?: string | null;
  readonly budgetMaxUsd?: number | null;
  /**
   * Epoch de fencing (M-11) réellement envoyé au PC pour ce dispatch.
   *
   * `☠` Ce champ MANQUAIT, et son absence a neutralisé le correctif du 23/07 :
   * `prochainEpoch()` calcule `max(epochs) + 1` en lisant cette colonne, mais
   * rien ne l'écrivait jamais. Toutes les missions restaient à 0 (mesuré le
   * 31/07 : cinq sur cinq, dont trois sur un même worktree), donc le calcul
   * rendait éternellement `1` — la constante en dur qu'il était censé remplacer,
   * atteinte par un chemin plus long. Un epoch identique sur deux workers du
   * même worktree est exactement ce que le fencing doit rejeter.
   */
  readonly epoch?: number | null;
  /** Conversation d'origine (migration 14). Absente ⇒ mission sans destinataire. */
  readonly conversationId?: string | null;
}

/** Historique des transitions — `origine` préserve la distinction même a posteriori. */
export interface Transition {
  readonly id: number;
  readonly missionId: string;
  readonly origine: OrigineTransition;
  readonly etatPrecedent: string | null;
  readonly etatNouveau: string;
  readonly motif: string | null;
  readonly survenuA: number;
}

/** Capacité annoncée par SDKSystemMessage.capabilities (E.5). Parc hétérogène assumé. */
export interface Capacite {
  readonly missionId: string;
  readonly capacite: string;
  readonly presente: boolean;
  readonly observeA: number;
}

export type StatutConversation = 'active' | 'archivee';

/**
 * Un fil de discussion avec l'orchestrateur. `sessionId` est l'identité SDK
 * fixée (reprise après redémarrage) — `null` tant que la session n'a jamais
 * tourné.
 */
export interface Conversation {
  readonly id: string;
  readonly titre: string;
  readonly sessionId: string | null;
  readonly statut: StatutConversation;
  readonly creeA: number;
  readonly majA: number;
  /** Nombre de compactions subies par ce fil (affiché à l'écran). */
  readonly compactions: number;
  /** Résumé réinjecté à la prochaine session après compaction. */
  readonly resumeContexte: string | null;
  /**
   * Dernier modèle et effort utilisés dans ce fil. `☠` C'est ce qui permet de
   * ROUVRIR la conversation là où on l'avait laissée : l'UI retombait sur ses
   * défauts (Opus 4.8 / high) à chaque rafraîchissement, en contradiction avec
   * le message affiché juste au-dessus.
   */
  readonly modele: string | null;
  readonly effort: string | null;
}

export type TypeEvenementConversation =
  | 'operateur'
  | 'reflexion'
  | 'texte'
  | 'outil'
  | 'resultat'
  | 'erreur'
  /** Marqueur laissé dans le fil à chaque compaction — contenu : le résumé retenu. */
  | 'compaction'
  /** Proposition de mandat (H-61) — contenu : l'identifiant de la proposition. */
  | 'mandat'
  /**
   * Fait du parc remis à l'orchestrateur par le harness (migration 14).
   *
   * `☠` Type DISTINCT de `operateur`, et c'est H-66 : « une équipe a terminé »
   * n'est pas une parole de Chris. Les confondre ferait attribuer au maître
   * d'ouvrage des instructions que le harness a fabriquées — la confusion
   * précise que H-66 existe pour empêcher.
   */
  | 'notification';

export type StatutProposition = 'en_attente' | 'approuvee' | 'refusee';

/** Mandat proposé par l'orchestrateur, en attente d'autorisation humaine (H-61). */
export interface Proposition {
  readonly id: string;
  readonly conversationId: string | null;
  readonly projet: string;
  readonly objectif: string;
  readonly critereArret: string | null;
  /** Cadre de travail en clair, pour le lead. Descriptif — ne porte aucun droit. */
  readonly perimetre: string;
  /**
   * Ce que l'équipe pourra RÉELLEMENT faire. `lecture` refuse les outils
   * d'écriture au worker (`shared/acces-mandat.ts`) ; `perimetre` ne l'a jamais
   * fait — il ne partait que dans le prompt initial.
   */
  readonly acces: AccesMandat;
  readonly budgetMaxUsd: number;
  /** Modèle du lead. `null` ⇒ le défaut du dispatch (Opus 4.8). */
  readonly modele: string | null;
  /** Niveau de raisonnement. `null` ⇒ le défaut du dispatch (high). */
  readonly effort: string | null;
  readonly statut: StatutProposition;
  readonly missionId: string | null;
  readonly detail: string | null;
  readonly creeA: number;
  readonly majA: number;
}

/** Un bloc du fil, dans l'ordre d'arrivée. `seq` est le curseur de streaming. */
export interface EvenementConversation {
  readonly seq: number;
  readonly conversationId: string;
  readonly type: TypeEvenementConversation;
  readonly contenu: string;
  readonly creeA: number;
  /**
   * Modèle et effort qui ont RÉELLEMENT produit cet évènement.
   *
   * `☠` Portés par l'évènement, pas seulement par la conversation : changer de
   * modèle en cours de fil ne doit pas réécrire l'attribution des réponses déjà
   * rendues. Sans ça, impossible de savoir laquelle venait de quel modèle —
   * exactement la friction remontée le 23/07.
   */
  readonly modele: string | null;
  readonly effort: string | null;
}

/**
 * Nature d'un fait notifiable. Liste OUVERTE par conception : l'interface
 * affiche un type qu'elle ne connaît pas plutôt que de refuser la ligne, et un
 * type ajouté côté Pi n'exige pas de déployer le front le même jour.
 */
export type TypeNotification =
  /** Une équipe a rendu sa réponse — le fait qui a motivé tout ce canal. */
  | 'equipe_terminee'
  /** Une équipe s'est arrêtée sur un échec ou a disparu. */
  | 'equipe_echouee'
  | (string & {});

/**
 * Un fait du parc destiné à être lu. `☠` Deux destinataires, jamais confondus :
 * Chris dans l'interface (`luA`) et l'orchestrateur dans son fil (`remisA`).
 * Marquer l'un ne dit rien de l'autre — Chris peut lire une notification que
 * l'orchestrateur n'a jamais reçue, et l'inverse est le cas normal la nuit.
 */
export interface Notification {
  readonly id: string;
  readonly type: TypeNotification;
  readonly missionId: string | null;
  readonly conversationId: string | null;
  readonly titre: string;
  readonly corps: string;
  readonly creeA: number;
  /** Lue par Chris dans l'interface. */
  readonly luA: number | null;
  /** Remise à l'orchestrateur, entrée dans son contexte. */
  readonly remisA: number | null;
  /** Dernière raison d'échec de remise. N'empêche pas une nouvelle tentative. */
  readonly echecRemise: string | null;
}

/** Vue « où en est ce que j'ai demandé hier soir ? » (F2.0.1). */
export interface AvancementLot {
  readonly lot: Lot;
  readonly missions: readonly Mission[];
  readonly total: number;
  readonly actives: number;
  readonly terminees: number;
  readonly echecs: number;
}
