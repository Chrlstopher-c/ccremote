/**
 * Responsabilité : le CONTRAT du fichier de mesures. C'est la seule frontière entre
 * le protocole expérimental (qui produit) et le générateur de page (qui consomme).
 *
 * `☠` La page ne lit RIEN d'autre que ce fichier. Aucun chiffre de la page n'est
 * écrit dans le générateur : s'il n'est pas ici, il n'apparaît pas là-bas.
 *
 * Documenté en prose dans `../CONTRAT-MESURES.md`.
 */

/**
 * Les trois conditions du protocole. La seule différence entre elles est le bloc de
 * leçons ajouté au mandat — mandat, tâche, modèle et projet sont identiques.
 *
 * - `sans_lecon`         : mandat nu. C'est aussi le SENS INVERSE (leçon retirée).
 * - `avec_lecon`         : mandat + bloc de leçons contenant la leçon du piège.
 * - `lecon_hors_sujet`   : mandat + bloc de leçons de même forme et longueur comparable,
 *                          mais sans rapport avec le piège. Contrôle placebo : sépare
 *                          « la leçon aide » de « un bloc de texte en plus met en alerte ».
 */
export type Condition = 'sans_lecon' | 'avec_lecon' | 'lecon_hors_sujet';

export const CONDITIONS: readonly Condition[] = ['sans_lecon', 'avec_lecon', 'lecon_hors_sujet'];

/** Usage d'un outil sur une exécution, relevé dans le JSONL (`tool_use` / `tool_result`). */
export interface UsageOutil {
  readonly nom: string;
  readonly appels: number;
  /** `tool_result` portant `is_error: true`. */
  readonly echecs: number;
}

/**
 * Une invocation de la suite de tests par l'agent, dans l'ordre où elle apparaît
 * dans le transcript. C'est la mesure centrale : « tentatives avant succès ».
 */
export interface TentativeTest {
  /** 1 pour la première invocation de la suite de tests. */
  readonly rang: number;
  /** Commande exacte, telle qu'écrite par l'agent dans l'entrée `tool_use` Bash. */
  readonly commande: string;
  /** Le `tool_result` correspondant ne porte pas d'erreur ET annonce des tests passés. */
  readonly reussie: boolean;
  /** Millisecondes écoulées depuis la première ligne du transcript. */
  readonly survenueA: number;
}

/** Une exécution = un agent, une condition, une répétition. Toutes ses valeurs viennent du JSONL. */
export interface Execution {
  readonly id: string;
  readonly condition: Condition;
  /** 1..N. */
  readonly repetition: number;
  readonly sessionId: string;
  /** Chemin absolu du transcript JSONL d'où toutes les mesures ci-dessous sont extraites. */
  readonly transcript: string;
  readonly modele: string;
  readonly demarreeA: string;
  readonly dureeMs: number;
  /** `null` si le SDK n'a rendu aucun coût pour cette exécution. */
  readonly coutUsd: number | null;
  /** Nombre d'entrées `assistant` du transcript. */
  readonly nbTours: number;
  readonly usageOutils: readonly UsageOutil[];
  readonly appelsOutilsTotal: number;
  readonly tentatives: readonly TentativeTest[];
  /** Rang de la première tentative réussie. `null` = la suite n'a jamais passé. */
  readonly tentativesAvantSucces: number | null;
  /** `tentativesAvantSucces === 1`. Le fait binaire qui intéresse l'opérateur. */
  readonly reussiDuPremierCoup: boolean;
  /**
   * Verdict du vérificateur EXTERNE : la commande livrée par l'agent, rejouée sur une
   * copie FRAÎCHE du projet piégé, fait passer la suite. Ne dépend d'aucune déclaration
   * de l'agent et ignore toute modification qu'il aurait faite au projet.
   */
  readonly succesVerifie: boolean;
  /** Contenu utile de `COMMANDE.md` tel que livré par l'agent. `null` si absent. */
  readonly commandeLivree: string | null;
}

/** Agrégat d'une condition. Toutes les valeurs sont dérivées des `Execution` du même fichier. */
export interface AgregatCondition {
  readonly condition: Condition;
  readonly executions: number;
  readonly succesVerifie: number;
  readonly reussiDuPremierCoup: number;
  readonly tentativesMediane: number | null;
  readonly tentativesMoyenne: number | null;
  readonly dureeMedianeMs: number;
  readonly coutMoyenUsd: number | null;
  readonly appelsOutilsMoyens: number;
}

/** Une ligne d'extrait de transcript montrée telle quelle dans la page. */
export interface LigneTrace {
  readonly role: 'outil' | 'resultat' | 'texte';
  /** Nom de l'outil pour `outil`, vide sinon. */
  readonly outil: string;
  readonly texte: string;
}

/**
 * Les traces réelles que la page affiche. Chacune porte le transcript d'où elle sort :
 * un lecteur sceptique doit pouvoir aller la relire.
 */
export interface Traces {
  /** La leçon, mot pour mot, telle qu'injectée dans le mandat. */
  readonly leconMotPourMot: string;
  /** Où la leçon se retrouve dans le contexte de l'équipe suivante. */
  readonly injection: {
    readonly transcript: string;
    readonly ligneJsonl: number;
    readonly extrait: string;
  } | null;
  /** Extrait du tâtonnement d'une exécution `sans_lecon`. */
  readonly tatonnement: { readonly transcript: string; readonly lignes: readonly LigneTrace[] } | null;
  /** Extrait d'une exécution `avec_lecon` allant droit au but. */
  readonly direct: { readonly transcript: string; readonly lignes: readonly LigneTrace[] } | null;
}

/** Description du protocole, reprise telle quelle par la page — jamais reformulée par elle. */
export interface DescriptifProtocole {
  readonly modele: string;
  readonly repetitionsParCondition: number;
  readonly conditions: readonly Condition[];
  readonly piege: string;
  readonly tache: string;
  readonly mandatMotPourMot: string;
  /** Le bloc ajouté au mandat par condition. `null` pour la condition nue. */
  readonly blocsLecons: Readonly<Record<Condition, string | null>>;
  readonly critereSucces: string;
  /** Ce que l'expérience ne prouve pas. Affiché intégralement par la page. */
  readonly limites: readonly string[];
}

/** Le fichier de mesures. `version` change dès qu'un champ existant change de sens. */
export interface FichierMesures {
  readonly version: 1;
  /**
   * `☠` `true` ⇒ la page affiche un bandeau d'avertissement inamovible en tête.
   * Le générateur n'a aucun moyen de produire une page sans bandeau à partir d'un
   * fichier `factice: true`.
   */
  readonly factice: boolean;
  /** Obligatoire si `factice` est `true` : pourquoi ces chiffres ne sont pas des mesures. */
  readonly raisonFactice: string | null;
  readonly genereA: string;
  readonly protocole: DescriptifProtocole;
  readonly executions: readonly Execution[];
  readonly agregats: readonly AgregatCondition[];
  readonly traces: Traces;
}
