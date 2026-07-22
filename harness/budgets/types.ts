/**
 * Responsabilité : formes de données du domaine « budgets/garde-fous » (branche G,
 * mission M-51). Aucune I/O ici.
 *
 * ☠ Rappel structurant (H-58, H-68, H-69, corrigeant la spec d'origine) : un montant en
 * dollars est inobservable sur un compte par abonnement (`limit_dollars`/`used_dollars`/
 * `remaining_dollars` reviennent `null`, mesuré) et n'est de toute façon PAS un détecteur
 * de boucle (H-68 — l'anti-boucle est un juge Haiku, hors périmètre de ce module). Ce
 * domaine ne borne QUE ce qui est réellement mesurable : les trois catégories de messages
 * d'usage (E.4.3/G.1.4) et le pourcentage d'utilisation par fenêtre de quota (H-54/H-63).
 */

/**
 * Trois catégories distinctes, jamais confondues (acceptation (c), panne #16) :
 * - `limite_atteinte`  : la limite est réellement atteinte (USAGE_LIMIT_ERROR_PREFIXES).
 * - `transition`       : bascule vers les crédits/l'overage, pas une erreur (USAGE_TRANSITION_PREFIXES).
 * - `avertissement`    : approche de la limite, purement informatif (USAGE_WARNING_PREFIXES).
 * - `aucune`           : texte non reconnu comme message d'usage.
 */
export type CategorieMessageUsage = 'limite_atteinte' | 'transition' | 'avertissement' | 'aucune';

export interface ClassificationMessageUsage {
  readonly categorie: CategorieMessageUsage;
  /** Préfixe SDK exact ayant matché, `null` si `categorie === 'aucune'`. */
  readonly prefixe: string | null;
  readonly texteBrut: string;
}

/**
 * Comportement au franchissement (G.1.4) : encodé en trois booléens indépendants plutôt
 * qu'une seule action, précisément pour rendre impossible de confondre « suspendre » et
 * « notifier » — c'est le cœur testable de l'acceptation (c).
 */
export interface DecisionUsage {
  readonly classification: ClassificationMessageUsage;
  readonly suspendreCreations: boolean;
  readonly notifier: boolean;
  readonly tracer: boolean;
  readonly motif: string;
}

/** Statuts vérifiés de `SDKRateLimitInfo.status` (H-54). */
export type StatutQuotaObserve = 'allowed' | 'allowed_warning' | 'rejected';

/** Relevé minimal nécessaire à la décision de plafond — pas le schéma complet du registre (E.1). */
export interface RelevePourPlafond {
  readonly compteId: string;
  readonly typeFenetre: string;
  /** 0-100, `null` si le SDK ne l'a pas fourni (H-54 : `utilization` est optionnel). */
  readonly utilisation: number | null;
  readonly statut: StatutQuotaObserve;
}

/**
 * `seuilUtilisationPct` non défini ⇒ plafond désactivé (H-58 : « codé, sans seuil par
 * défaut »). L'opérateur pose un chiffre le jour où le contexte change.
 */
export interface ConfigPlafondParc {
  readonly seuilUtilisationPct?: number;
}

/**
 * `☠` Structurellement incapable de désigner une mission à tuer — aucun champ ne le
 * permet. C'est la preuve par le type que ce plafond ne peut agir QUE sur la création
 * (G.1.3 : « il ne tue pas les équipes en cours »).
 */
export interface DecisionPlafondParc {
  readonly autorise: boolean;
  readonly motif: string;
}

export interface DecisionRetryWatchdog {
  readonly autorise: boolean;
  readonly motif: string;
}

/** Événement de quota observé sur le flux d'un worker (`rate_limit_event`, H-54/H-63). */
export interface EvenementQuotaObserve {
  readonly missionId: string;
  readonly sessionId: string;
  readonly statut: StatutQuotaObserve;
  readonly rateLimitType: string | null;
  readonly utilisation: number | null;
  readonly resetsAt: number | null;
}

/**
 * Best-effort (H-15), même contrat que `ObservateurRelance` du superviseur : ne pousse
 * rien lui-même, n'ouvre aucune connexion. La persistance réelle (registre du Pi, E.1)
 * et la notification (Web Push/Discord, H-59) sont hors périmètre de ce module.
 */
export interface ObservateurUsage {
  surQuota?(evenement: EvenementQuotaObserve): void;
  surMessageUsage?(missionId: string, decision: DecisionUsage): void;
}
