/**
 * Responsabilité : formes de données de la discipline de contexte (A.1.4 +
 * E.4.1, mission M-42). Aucune I/O ici.
 *
 * Portée : savoir si l'orchestrateur maître sature son contexte AVANT que ça
 * dégrade ses réponses (a), savoir quand il compacte via les deux sources
 * disponibles — hooks et flux (b) — et surtout distinguer la compaction saine
 * de la compaction pathologique (c). H-62 fait autorité : l'orchestrateur
 * autocompacte par conception, ce n'est jamais interdit. Ce module ne bloque
 * ni ne freine la compaction — il l'observe et juge sa fréquence.
 */

/**
 * Sous-ensemble structurel de `Query` (sdk.d.ts) utilisé ici. On ne dépend que
 * de la méthode consommée — pas de tout `Query` — pour ne pas coupler ce
 * module au reste de la surface de contrôle du SDK.
 *
 * `⚠` Mesuré en réel le 2026-07-22 : `capabilities` (SDKSystemMessage) est
 * revenu VIDE en session réelle. On ne déduit donc jamais la présence de
 * `getContextUsage` d'un numéro de version ni d'une capacité annoncée — on la
 * constate à l'exécution (`typeof source.getContextUsage === 'function'`),
 * voir `echantillonneur-contexte.ts`.
 */
export interface SourceContexte {
  getContextUsage(): Promise<MesureBrute>
}

/**
 * Forme structurelle de `SDKControlGetContextUsageResponse` (sdk.d.ts:3033) —
 * seuls les champs consommés par la discipline de contexte. Le type SDK porte
 * aussi `categories`, `gridRows`, `memoryFiles`, `mcpTools`… utiles à l'UI de
 * détail (E.4.1 mentionne la répartition par catégorie) mais pas au verdict
 * sain/pathologique, qui ne regarde que le total face au plafond.
 */
export interface MesureBrute {
  readonly totalTokens: number
  readonly maxTokens: number
  readonly model: string
}

export type NiveauContexte = 'sain' | 'attention' | 'alerte'

export interface SeuilsContexte {
  /** Fraction de `maxTokens` (0..1) à partir de laquelle on passe en 'attention'. */
  readonly attention: number
  /** Fraction de `maxTokens` (0..1) à partir de laquelle on passe en 'alerte'. */
  readonly alerte: number
}

/**
 * 60 % / 85 %. Le SDK autocompacte lui-même bien avant la limite technique
 * (H-62) : ces seuils servent l'observabilité humaine (jauge H-63), pas un
 * frein — rien ici n'empêche le SDK d'agir à sa propre discrétion.
 */
export const SEUILS_PAR_DEFAUT: SeuilsContexte = { attention: 0.6, alerte: 0.85 }

export interface MesureContexte {
  readonly instant: number
  readonly totalTokens: number
  readonly maxTokens: number
  /** `totalTokens / maxTokens`, calculé ici — voir note dans echantillonneur-contexte.ts
   *  sur pourquoi le champ `percentage` du SDK n'est pas utilisé pour ce calcul. */
  readonly ratio: number
  readonly niveau: NiveauContexte
  readonly model: string
}

/**
 * États terminaux de l'échantillonneur. Aucun n'est une erreur en soi — voir
 * `echantillonneur-contexte.ts` pour la distinction entre fin attendue et
 * panne réelle.
 */
export type EtatEchantillonnage =
  | 'actif'
  | 'arrete_volontairement'
  | 'arrete_session_terminee'
  | 'arrete_indisponible'
  | 'arrete_echecs'

export type TriggerCompaction = 'manual' | 'auto'

/** D'où vient le signal observé — les deux sources vérifiées de A.1.4/E.4.1. */
export type OrigineCompaction = 'hook' | 'message_flux'

export interface SignalCompaction {
  readonly trigger: TriggerCompaction
  readonly origine: OrigineCompaction
  readonly preTokens?: number
  readonly postTokens?: number
}

export type SeveriteCompaction = 'normal' | 'defaut'

/**
 * Verdict sur UN événement de compaction, après dédup et classification.
 * `origines` porte toutes les sources ayant rapporté ce même événement
 * physique (hook seul, message seul, ou les deux) — jamais un doublon compté
 * deux fois dans `compteAutoDansFenetre`.
 */
export interface EvenementCompactionObserve {
  readonly instant: number
  readonly trigger: TriggerCompaction
  readonly origines: readonly OrigineCompaction[]
  readonly severite: SeveriteCompaction
  readonly motif: string
  /** `null` si aucune compaction AUTO antérieure, ou si `trigger === 'manual'`. */
  readonly intervalleDepuisPrecedenteAutoMs: number | null
  /** Toujours 0 pour `trigger === 'manual'` : le manuel n'entre pas dans le calcul. */
  readonly compteAutoDansFenetre: number
}

export interface SeuilsPathologie {
  /** En dessous de ce délai, deux compactions AUTO consécutives sont un défaut. */
  readonly intervalleMinMs: number
  /** Fenêtre glissante sur laquelle compter les compactions AUTO. */
  readonly fenetreMs: number
  /** Nombre de compactions AUTO dans la fenêtre à partir duquel c'est un défaut. */
  readonly compteMax: number
  /** Fenêtre de tolérance pour fusionner hook + message comme un seul événement. */
  readonly dedupMs: number
}

/**
 * Seuil de compaction pathologique — le cœur de la mission (c).
 *
 * Argumentation chiffrée : avec H-45 (aucun flux brut dans le contexte de
 * l'orchestrateur, seulement des résumés d'une ligne), un tour normal ajoute
 * de l'ordre de quelques centaines à ~1500 tokens (résumé + décision de
 * dispatch + appel d'outil de contrôle). Une compaction ramène le contexte à
 * une fraction basse de son plafond (le préservé + le résumé de compaction,
 * grossièrement 20-30 % pour un modèle Opus ~200k tokens). Recharger jusqu'au
 * seuil d'alerte (60 points de pourcentage, ~120k tokens) demanderait, même à
 * un rythme de dispatch très soutenu (un tour toutes les 30 s en continu, ce
 * qu'aucune conversation humaine ne soutient), environ 80-150 minutes.
 *
 * Deux compactions AUTO à moins de 15 minutes d'écart sont donc déjà 5 à 10
 * fois plus rapprochées que le pire scénario légitime plausible — ce n'est
 * pas de la marge de bruit, c'est un signal de fuite (panne #17 de la grille :
 * flux brut routé vers l'orchestrateur). `intervalleMinMs` est fixé à 15 min.
 *
 * Second signal, redondant par construction : 3 compactions AUTO en 60
 * minutes (`fenetreMs`/`compteMax`) — attrape le cas où chaque intervalle pris
 * isolément dépasse 15 min mais où la cadence d'ensemble est déjà anormale
 * (moyenne ≤ 20 min/compaction). Les deux signaux sont un OR : soit suffit à
 * qualifier `defaut`.
 *
 * Choisi trop bas → bruit (une compaction normale ferait crier le système,
 * l'opérateur coupe l'alerte). Choisi trop haut (ex. 2h/1) → ne se déclenche
 * jamais avant que la dégradation soit déjà visible dans les réponses, ce que
 * la mission interdit explicitement. 15 min / 3 par heure est le point où le
 * calcul ci-dessus place la limite du plausible sain.
 */
export const SEUILS_PATHOLOGIE_PAR_DEFAUT: SeuilsPathologie = {
  intervalleMinMs: 15 * 60_000,
  fenetreMs: 60 * 60_000,
  compteMax: 3,
  dedupMs: 5_000,
}
