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
}

export interface ConversationApi {
  readonly id: string;
  readonly titre: string;
  readonly creeA: number;
  readonly majA: number;
  readonly active: boolean;
  readonly contextPct: number | null;
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
    readonly partiel: { readonly type: TypeEvenementConversation; readonly contenu: string } | null;
  } | null;
  evenementsDepuis(id: string, depuis: number): {
    readonly evenements: readonly EvenementConversation[];
    readonly curseur: number;
    readonly genere: boolean;
    readonly active: boolean;
    readonly contextePct: number | null;
    readonly partiel: { readonly type: TypeEvenementConversation; readonly contenu: string } | null;
  } | null;
  envoyer(id: string, texte: string): Promise<void>;
}

export function versEvenementApi(ev: EvenementConversation): EvenementApi {
  return { seq: ev.seq, type: ev.type, contenu: ev.contenu, at: ev.creeA };
}

export function versConversationApi(entree: {
  readonly id: string;
  readonly titre: string;
  readonly creeA: number;
  readonly majA: number;
  readonly active: boolean;
  readonly contextePct: number | null;
}): ConversationApi {
  return {
    id: entree.id,
    titre: entree.titre,
    creeA: entree.creeA,
    majA: entree.majA,
    active: entree.active,
    contextPct: entree.contextePct,
  };
}
