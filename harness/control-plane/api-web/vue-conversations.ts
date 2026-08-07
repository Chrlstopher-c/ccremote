/**
 * Responsabilité : traduire les conversations orchestrateur (domaine) vers le
 * JSON servi à l'UI, et définir le port dont l'API a besoin (implémenté par
 * `GestionnaireConversations`).
 *
 * `☠` L'API ne dépend PAS de la classe gestionnaire, seulement de ce port : la
 * dépendance va du concret vers l'abstrait, jamais l'inverse.
 */

import { ecrireReglagePlafond } from '../autonomie/index.ts';
import type { Conversation, EvenementConversation, TypeEvenementConversation } from '../registre/index.ts';

export interface EvenementApi {
  readonly seq: number;
  readonly type: TypeEvenementConversation;
  readonly contenu: string;
  readonly at: number;
  /**
   * Ce qui a produit cet évènement. `☠` Porté PAR ÉVÈNEMENT : un fil où
   * l'opérateur change de modèle en cours de route doit rester lisible après
   * coup — sans ça, impossible de savoir quelle réponse venait de quel modèle.
   */
  readonly model: string | null;
  readonly effort: string | null;
  /**
   * Appels d'outils uniquement (migration 21) : ce que l'appel a demandé, et ce
   * qu'il a rendu.
   *
   * `☠` `resultat: null` veut dire « pas encore revenu », JAMAIS « vide ».
   * L'écran doit afficher « en attente » — un outil présenté comme ayant répondu
   * du vide est un mensonge plus coûteux que l'absence d'information.
   */
  readonly detail: string | null;
  readonly resultat: string | null;
  /**
   * Pièces jointes du message opérateur (migration 24) — vide partout ailleurs.
   *
   * `☠` `url` est servie par le control plane et relayée par pi-web, qui porte
   * l'authentification : jamais un chemin de fichier, que le navigateur ne
   * pourrait pas ouvrir et qui révélerait l'arborescence du Pi.
   */
  readonly pieces: readonly PieceJointeApi[];
}

export interface PieceJointeApi {
  readonly nom: string;
  readonly type: string;
  readonly taille: number;
  readonly url: string;
}

/**
 * Fenêtre d'autonomie du fil (migration 15) et plafond d'équipes lançables sans
 * clic (migration 26).
 *
 * `☠` Ces quatre colonnes existaient en base et n'étaient resservies par AUCUNE
 * route. L'interface ne pouvait donc pas savoir si une plage courait, et
 * affirmait « aucune plage » sur une donnée que personne n'avait lue — une
 * affirmation fausse, et c'est la nuit qu'elle coûte le plus cher, quand Chris
 * dort en croyant avoir délégué.
 */
export interface AutonomieFilApi {
  readonly autonomieDebut: number | null;
  readonly autonomieFin: number | null;
  readonly autonomieObjectif: string | null;
  /**
   * Forme lisible du réglage : un entier en texte, « illimite », ou « herite »
   * quand le fil ne règle rien et hérite du défaut du parc.
   *
   * `☠` Les trois états sont DISTINCTS (`autonomie/reglage-plafond.ts`) :
   * confondre « non réglé » et « illimité » afficherait un fil neuf comme
   * délibérément affranchi.
   */
  readonly plafondAutonomie: string;
}

/**
 * `☠` `null` — fil absent du registre — rend la forme la plus CONSERVATRICE
 * (aucune plage, plafond hérité) plutôt qu'un champ manquant que l'écran lirait
 * comme « pas encore chargé ». Le cas ne se produit pas en pratique : le
 * gestionnaire de conversations lit ce même registre.
 */
export function versAutonomieFilApi(conversation: Conversation | null): AutonomieFilApi {
  if (conversation === null) {
    return { autonomieDebut: null, autonomieFin: null, autonomieObjectif: null, plafondAutonomie: 'herite' };
  }
  return {
    autonomieDebut: conversation.autonomieDebut,
    autonomieFin: conversation.autonomieFin,
    autonomieObjectif: conversation.autonomieObjectif,
    // Même encodage que `vue-rallonges.ts` : une seule version de la forme
    // écrite, déjà testée sur `conversation.plafond_autonomie`.
    plafondAutonomie: ecrireReglagePlafond(conversation.plafondAutonomie) ?? 'herite',
  };
}

export interface ConversationApi extends AutonomieFilApi {
  readonly id: string;
  readonly titre: string;
  readonly creeA: number;
  readonly majA: number;
  readonly active: boolean;
  readonly contextPct: number | null;
  readonly compactions: number;
  /**
   * Dernier couple utilisé dans ce fil — ce sur quoi l'interface doit ROUVRIR.
   * `null` sur un fil vierge : c'est alors, et alors seulement, que les défauts
   * s'appliquent.
   */
  readonly model: string | null;
  readonly effort: string | null;
  /**
   * Machine de travail du fil (migration 22). `null` ⇒ fil antérieur au
   * sélecteur : l'interface l'affiche comme « non précisée », jamais comme une
   * machine par défaut qui n'a jamais été choisie.
   */
  readonly machine: string | null;
}

export interface DetailConversationApi extends ConversationApi {
  readonly events: readonly EvenementApi[];
  readonly cursor: number;
  readonly generating: boolean;
}

/** Bloc en cours de frappe — sert le streaming token par token côté interface. */
export interface PartielApi {
  readonly type: TypeEvenementConversation;
  readonly contenu: string;
}

export interface EvenementsApi {
  readonly events: readonly EvenementApi[];
  readonly cursor: number;
  readonly generating: boolean;
  readonly active: boolean;
  readonly contextPct: number | null;
  readonly compactions: number;
  readonly partial: PartielApi | null;
}

/** Port des conversations, vu de l'API. Implémenté par `GestionnaireConversations`. */
export interface PortConversations {
  listerConversations(): readonly {
    readonly id: string;
    readonly titre: string;
    readonly creeA: number;
    readonly majA: number;
    readonly active: boolean;
    readonly contextePct: number | null;
    readonly compactions: number;
    readonly machine: string | null;
  }[];
  creer(
    titre?: string,
    machine?: string | null,
  ): { readonly id: string; readonly titre: string; readonly creeA: number; readonly majA: number };
  renommer(id: string, titre: string): boolean;
  archiver(id: string): boolean;
  detail(id: string): {
    readonly id: string;
    readonly titre: string;
    readonly evenements: readonly EvenementConversation[];
    readonly curseur: number;
    readonly genere: boolean;
    readonly active: boolean;
    readonly contextePct: number | null;
    readonly compactions: number;
    readonly modele: string | null;
    readonly effort: string | null;
    readonly modeRapide: boolean | null;
    readonly partiel: { readonly type: TypeEvenementConversation; readonly contenu: string } | null;
  } | null;
  evenementsDepuis(id: string, depuis: number): {
    readonly evenements: readonly EvenementConversation[];
    readonly curseur: number;
    readonly genere: boolean;
    readonly active: boolean;
    readonly contextePct: number | null;
    readonly compactions: number;
    readonly partiel: { readonly type: TypeEvenementConversation; readonly contenu: string } | null;
  } | null;
  /**
   * `choix` absent ou partiel ⇒ le fil garde ce qu'il utilisait déjà. `☠` Ces
   * valeurs étaient reçues par la route puis jetées : le sélecteur de
   * l'interface n'avait aucun effet sur la session (23/07).
   */
  envoyer(
    id: string,
    texte: string,
    choix?: { readonly modele?: string; readonly effort?: string; readonly modeRapide?: boolean },
    /** Pièces jointes brutes du navigateur (migration 24) — validées côté domaine, jamais ici. */
    pieces?: readonly { readonly nom: unknown; readonly type: unknown; readonly donneesBase64: unknown }[],
  ): Promise<void>;
  compacter(id: string): Promise<{ readonly compacte: boolean; readonly detail: string }>;
  /** Coupe le tour en cours. N'allume aucune session : un fil au repos rend `interrompu: false`. */
  interrompre(id: string): Promise<{ readonly interrompu: boolean; readonly detail: string }>;
}

/** URL de relecture d'une pièce — le seul endroit qui connaît la forme de cette route. */
export function urlPieceJointe(conversationId: string, fichier: string): string {
  return `/api/harness/orchestrator/conversations/${encodeURIComponent(conversationId)}/pieces/${encodeURIComponent(fichier)}`;
}

export function versEvenementApi(ev: EvenementConversation): EvenementApi {
  return {
    seq: ev.seq,
    type: ev.type,
    contenu: ev.contenu,
    at: ev.creeA,
    model: ev.modele,
    effort: ev.effort,
    detail: ev.detail,
    resultat: ev.resultat,
    pieces: ev.pieces.map((p) => ({
      nom: p.nom,
      type: p.type,
      taille: p.taille,
      url: urlPieceJointe(ev.conversationId, p.fichier),
    })),
  };
}

/**
 * `☠` `autonomie` est un paramètre OBLIGATOIRE, jamais un défaut optionnel :
 * l'entrée du port ne la porte pas (elle vit dans le registre), et un paramètre
 * facultatif ferait servir en silence « aucune plage, plafond hérité » à chaque
 * appelant qui l'oublie — c'est-à-dire exactement l'affirmation fausse qu'on
 * vient de corriger. Le typecheck force chaque site d'appel à la fournir.
 */
export function versConversationApi(
  entree: {
    readonly id: string;
    readonly titre: string;
    readonly creeA: number;
    readonly majA: number;
    readonly active: boolean;
    readonly contextePct: number | null;
    readonly compactions?: number;
    readonly modele?: string | null;
    readonly effort?: string | null;
    readonly machine?: string | null;
  },
  autonomie: AutonomieFilApi,
): ConversationApi {
  return {
    id: entree.id,
    titre: entree.titre,
    creeA: entree.creeA,
    majA: entree.majA,
    active: entree.active,
    contextPct: entree.contextePct,
    compactions: entree.compactions ?? 0,
    model: entree.modele ?? null,
    effort: entree.effort ?? null,
    machine: entree.machine ?? null,
    autonomieDebut: autonomie.autonomieDebut,
    autonomieFin: autonomie.autonomieFin,
    autonomieObjectif: autonomie.autonomieObjectif,
    plafondAutonomie: autonomie.plafondAutonomie,
  };
}

/** Autorisation des mandats proposés (H-61), vue de l'API. */
export interface PortMandats {
  enAttente(): readonly {
    readonly id: string;
    readonly projet: string;
    readonly objectif: string;
    readonly critereArret: string | null;
    readonly perimetre: string;
    /** `☠` Remonté jusqu'à l'écran : H-61 veut une autorisation ÉCLAIRÉE. */
    readonly acces: string;
    readonly budgetMaxUsd: number;
    readonly conversationId: string | null;
    readonly statut: string;
    readonly missionId: string | null;
    readonly detail: string | null;
  }[];
  approuver(id: string): Promise<{ readonly missionId: string; readonly detail: string }>;
  refuser(id: string): boolean;
}
