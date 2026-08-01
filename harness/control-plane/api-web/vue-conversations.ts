/**
 * Responsabilité : traduire les conversations orchestrateur (domaine) vers le
 * JSON servi à l'UI, et définir le port dont l'API a besoin (implémenté par
 * `GestionnaireConversations`).
 *
 * `☠` L'API ne dépend PAS de la classe gestionnaire, seulement de ce port : la
 * dépendance va du concret vers l'abstrait, jamais l'inverse.
 */

import type { EvenementConversation, TypeEvenementConversation } from '../registre/index.ts';

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
}

export interface ConversationApi {
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
  }[];
  creer(titre?: string): { readonly id: string; readonly titre: string; readonly creeA: number; readonly majA: number };
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
   * deux valeurs étaient reçues par la route puis jetées : le sélecteur de
   * l'interface n'avait aucun effet sur la session (23/07).
   */
  envoyer(id: string, texte: string, choix?: { readonly modele?: string; readonly effort?: string }): Promise<void>;
  compacter(id: string): Promise<{ readonly compacte: boolean; readonly detail: string }>;
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
  };
}

export function versConversationApi(entree: {
  readonly id: string;
  readonly titre: string;
  readonly creeA: number;
  readonly majA: number;
  readonly active: boolean;
  readonly contextePct: number | null;
  readonly compactions?: number;
  readonly modele?: string | null;
  readonly effort?: string | null;
}): ConversationApi {
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
