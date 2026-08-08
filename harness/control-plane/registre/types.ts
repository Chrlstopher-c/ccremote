/**
 * Responsabilité : formes de données du registre d'état (E.1.1, E.1.3).
 * Aucune I/O ici — uniquement les types du domaine « registre ».
 */

import type { AccesMandat } from '../../shared/acces-mandat.ts';
import type { EtatInspection } from '../inspection/etat-inspection.ts';
import type { ReglagePlafond } from '../autonomie/reglage-plafond.ts';

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

/**
 * États harness considérés comme occupant le projet. Sert deux règles distinctes,
 * arbitrées au point d'usage — jamais ici, qui ignore `estGit` :
 *  - H-56 stricte (mono-équipe) pour un projet NON-git, où `listerActives()`
 *    filtré par ces états refuse toute deuxième mission ;
 *  - le plafond git (mandat E3, `PLAFOND_EQUIPES_PROJET_GIT_DEFAUT`) pour un
 *    projet git, où la même liste sert à COMPTER les équipes actives plutôt
 *    qu'à en refuser plus d'une.
 * Voir `dispatch-mandat.ts` (garde applicative) et migration 25 (index partiel
 * restreint à `projet_est_git = 0`).
 */
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
  /** `tool_use_id` du SDK — la clé qui relie l'appel à son résultat. */
  readonly outilId?: string | null;
  /** Sortie de l'outil, tronquée à la source. `null` tant qu'elle n'est pas revenue. */
  readonly resultat?: string | null;
  readonly resultatErreur?: boolean;
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
  /**
   * Dernier verdict d'inspection (H-68) et ce que l'opérateur en a fait.
   * Cycle de vie et sémantique : `control-plane/inspection/etat-inspection.ts`.
   */
  readonly inspection: EtatInspection;
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
  /**
   * Machine de travail où cette équipe tourne RÉELLEMENT (migration 22).
   *
   * `☠` Écrite au dispatch, à partir de la machine effectivement utilisée. Sans
   * elle, un ordre d'arrêt, une relance ou un suivi ne savent à qui s'adresser
   * dès que deux machines tournent. `null` ⇒ mission antérieure au 01/08 : ne se
   * route qu'en l'absence d'ambiguïté (une seule machine en ligne).
   */
  readonly machine: string | null;
  /**
   * Le projet est-il un dépôt git (migration 25) ? C'est la colonne qui
   * conditionne H-56 : mono-équipe stricte pour un projet non-git (pas
   * d'isolation possible), multi-équipe pour un projet git (une équipe par
   * `git worktree`, plafonné en APPLICATION, pas en base — `dispatch-mandat.ts`).
   */
  readonly projetEstGit: boolean;
  /**
   * Ce que le dépôt de l'équipe contenait au dernier relevé (migration 23).
   *
   * `☠` `null` signifie « jamais mesuré », JAMAIS « propre ». C'est la
   * distinction qui manquait : une équipe qui rend la main avec du travail non
   * commité était présentée comme une équipe qui a livré.
   */
  readonly constatGit: {
    readonly fichiersModifies: number;
    readonly branche: string | null;
    readonly dernierCommit: string | null;
    readonly releveA: number;
  } | null;
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
  /** Machine de travail visée — voir `Mission.machine`. */
  readonly machine?: string | null;
  /** Absent ⇒ `false` : comportement mono-équipe préservé par défaut pour tout appelant
   * qui ne le fournit pas (tests, restauration…) — voir `Mission.projetEstGit`. */
  readonly projetEstGit?: boolean;
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
  /** D'où vient ce titre, donc qui peut le changer — voir `orchestrateur/titre-fil.ts`. */
  readonly titreSource: 'defaut' | 'auto' | 'manuel';
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
  /**
   * Mode rapide du fil (migration 28), même logique de persistance que le
   * couple ci-dessus. `☠` `null` = jamais tranché sur ce fil, le défaut du
   * compte s'applique ; `false` = coupé explicitement. Les confondre forcerait
   * un réglage à chaque message d'un fil qui n'a jamais rien demandé.
   */
  readonly modeRapide: boolean | null;
  /**
   * Fenêtre d'autonomie du fil (migration 15) — début, fin, et l'objectif que
   * Chris a confié pour cette plage.
   *
   * `☠` Les trois vont ensemble ou pas du tout. `autonomieFin` est aussi une
   * ÉCHÉANCE annoncée à l'orchestrateur, pas seulement un interrupteur : c'est
   * elle qui le fait arbitrer entre « je lance encore une équipe » et « je
   * consolide ce qui est fait ».
   */
  readonly autonomieDebut: number | null;
  readonly autonomieFin: number | null;
  readonly autonomieObjectif: string | null;
  /**
   * Plafond d'autonomie PROPRE à ce fil (migration 26) — combien d'équipes il
   * peut lancer sans qu'un humain reclique. `herite` : le défaut du parc
   * s'applique. Résolu par `plafondEffectif`, jamais lu tel quel.
   */
  readonly plafondAutonomie: ReglagePlafond;
  /**
   * Machine de travail choisie à la CRÉATION du fil (migration 22).
   *
   * `☠` Non modifiable ensuite, décision arbitrée avec Chris le 01/08 : une
   * équipe ne doit pas changer de machine au milieu d'un chantier. `null` ⇒ fil
   * antérieur au sélecteur : se résout seulement s'il n'y a aucune ambiguïté.
   */
  readonly machine: string | null;
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

export type StatutDemandeRallonge = 'en_attente' | 'accordee' | 'refusee';

/**
 * Demande d'un fil pour ÉLARGIR son autonomie (migrations 27 et 29) — relever
 * son plafond, ouvrir ou prolonger sa fenêtre datée, ou les deux.
 *
 * `☠` Distincte d'une `Proposition` (H-61) : celle-ci demande un DROIT DE
 * LANCER PLUS LONGTEMPS SANS CLIC, jamais un mandat d'équipe. L'accorder
 * n'ouvre aucun worker — elle applique un réglage au fil, via
 * `conversations.reglerPlafondAutonomie` et/ou `poserFenetreAutonomie`.
 *
 * `☠` Les deux volets sont INDÉPENDANTS et au moins un est présent (CHECK de
 * la migration 29). `plafondDemande` à `null` veut dire « ne touche pas au
 * plafond », jamais « remets-le au défaut ».
 */
export interface DemandeRallonge {
  readonly id: string;
  readonly conversationId: string;
  /** Plafond demandé, `null` si la demande ne porte que sur la plage. Jamais `herite`. */
  readonly plafondDemande: ReglagePlafond | null;
  /** Plage demandée (migration 29) — les trois ensemble, ou début/fin à `null`. */
  readonly fenetreDebut: number | null;
  readonly fenetreFin: number | null;
  readonly fenetreObjectif: string | null;
  readonly motif: string;
  readonly statut: StatutDemandeRallonge;
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
  /**
   * Appels d'outils uniquement (migration 21) — l'identifiant qui apparie
   * l'appel à son résultat, et ce que l'appel a demandé puis obtenu.
   *
   * `☠` `resultat` reste `null` tant que l'outil n'a pas répondu : c'est un état
   * NORMAL pendant l'exécution, pas une absence de donnée. L'interface doit le
   * lire comme « en cours », jamais comme « vide ».
   */
  readonly toolUseId: string | null;
  readonly detail: string | null;
  readonly resultat: string | null;
  /**
   * Pièces jointes du message opérateur (migration 24) — vide partout ailleurs.
   *
   * `☠` Descriptif seulement : les octets vivent sur le disque du Pi, pas en
   * base. Et pas de chemin absolu ici — il se recalcule depuis la racine
   * courante ; figé en base, il deviendrait faux le jour où la racine change.
   */
  readonly pieces: readonly PieceJointeMessage[];
}

/**
 * Une pièce jointe telle que le registre la connaît : ce qu'il faut pour la
 * retrouver sur le disque (`fichier`) et pour l'afficher (`nom`, `type`,
 * `taille`). `nom` est le nom d'ORIGINE — jamais utilisé pour construire un
 * chemin, il vient du navigateur.
 */
export interface PieceJointeMessage {
  readonly fichier: string;
  readonly nom: string;
  readonly type: string;
  readonly taille: number;
}

/**
 * Nature d'un fait notifiable. Liste OUVERTE par conception : l'interface
 * affiche un type qu'elle ne connaît pas plutôt que de refuser la ligne, et un
 * type ajouté côté Pi n'exige pas de déployer le front le même jour.
 */
/**
 * Qui a autorisé un mandat (migration 15).
 *
 * `☠` `null` en base = ligne antérieure à la migration, donc forcément un clic
 * humain : les relire comme `humain` est le comportement CORRECT, pas une
 * tolérance. L'inverse ferait croire qu'aucun fil n'a jamais été engagé.
 */
/**
 * Qui a tranché la proposition. `orchestrateur` (03/08) désigne le RETRAIT d'un
 * mandat par celui qui l'a proposé — ni une décision humaine, ni une
 * auto-approbation d'autonomie : les deux compteurs de H-61 l'ignorent, et c'est
 * voulu (un mandat retiré n'a jamais dépensé de droit de lancement).
 */
export type OrigineApprobation = 'humain' | 'auto' | 'orchestrateur';

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

/**
 * Un rappel programmé sur une conversation (migration 16).
 *
 * `☠` Appartient à UN fil et n'en sort jamais. C'est ce qui permet d'en avoir
 * plusieurs, indépendants, sans qu'un rappel de veille technique réveille le fil
 * où tourne un chantier de production.
 */
/**
 * `☠` ÉNUMÉRÉ, pas un booléen. « en pause » et « terminé » sont deux choses
 * différentes : la première se reprend, la seconde jamais. Un seul bit ferait
 * ressusciter des one-shots déjà tirés au premier « reprends ce rappel ».
 */
export type EtatRappel = 'actif' | 'en_pause' | 'termine';

export interface Rappel {
  readonly id: string;
  readonly conversationId: string;
  /** Nom court, pour que l'orchestrateur et l'écran désignent le même objet. */
  readonly libelle: string;
  /** Ce qui est injecté dans le fil au déclenchement — rédigé comme une consigne. */
  readonly consigne: string;
  /** Échéance ABSOLUE. Jamais un délai : un délai repart de zéro à chaque boot. */
  readonly prochaineA: number;
  /** `null` ⇒ rappel unique. Renseigné ⇒ récurrent. */
  readonly periodeMs: number | null;
  readonly etat: EtatRappel;
  readonly declenchements: number;
  /** Plafond de tirs, `null` = sans limite (borné par ailleurs à la création). */
  readonly maxDeclenchements: number | null;
  readonly dernierDeclenchementA: number | null;
  /** Dernier report ou échec, en clair. N'empêche jamais un tir ultérieur. */
  readonly derniereErreur: string | null;
  readonly creeA: number;
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
