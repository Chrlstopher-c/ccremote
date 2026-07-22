/**
 * Responsabilité : gérer N conversations orchestrateur INDÉPENDANTES (modèle
 * ChatGPT, décidé avec Chris le 23/07). Chaque conversation est sa propre
 * session Agent SDK — contexte isolé, `session_id` persisté pour la reprise
 * après un redémarrage du Pi.
 *
 * `☠` LAZY par conception : aucune session ne démarre au boot. Une session
 * consomme du quota en continu ; on n'en allume une que lorsque l'opérateur
 * écrit dans SA conversation. La réconciliation du parc, elle, ne dépend PAS de
 * ces sessions — elle est câblée sur le rattachement du PC (voir
 * `reconciliation-sur-rattachement.ts`), pas sur l'orchestrateur.
 *
 * `☠` UN SEUL lecteur par `query` (piège documenté sur `PoigneeOrchestrateur`).
 * Ce gestionnaire possède la boucle de lecture de chaque session ; personne
 * d'autre ne lit ces flux. Chaque message va à DEUX consommateurs : la
 * discipline de contexte (`poignee.ingererMessage`) et le collecteur de
 * streaming (`collecteur.ingerer`).
 *
 * `☠` Un fil = une session, mais chaque session peut piloter le parc (Chris l'a
 * accepté en toute connaissance). N sessions = N contextes et N× quota : c'est
 * le prix du modèle « conversations indépendantes ».
 */

import { randomUUID } from 'node:crypto';
import type { Conversation, EvenementConversation, Registre } from '../registre/index.ts';
import type { StockageIdentite } from './processus/index.ts';
import type { PoigneeOrchestrateur } from './processus/index.ts';
import { CollecteurConversation, type BlocPartiel } from './collecteur-conversation.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'gestionnaire-conversations' });

/** Construit la session SDK d'une conversation. Fourni par la composition (captures : serveur de contrôle, réconciliation, cwd…). */
export type ConstruireSessionConversation = (
  stockageIdentite: StockageIdentite,
  conversationId: string,
) => Promise<PoigneeOrchestrateur>;

/**
 * Adaptateur d'identité SDK adossé à la ligne de conversation : `lire()` rend le
 * `session_id` persisté (reprise), `ecrire()` le fixe au premier démarrage.
 * `resoudreIdentite` (SDK) fait le reste — reprise si le SDK connaît l'id.
 */
class StockageIdentiteConversation implements StockageIdentite {
  constructor(
    private readonly registre: Registre,
    private readonly conversationId: string,
  ) {}

  lire(): string | null {
    return this.registre.conversations.lire(this.conversationId)?.sessionId ?? null;
  }

  ecrire(sessionId: string): void {
    this.registre.conversations.majSessionId(this.conversationId, sessionId);
  }
}

interface SessionActive {
  readonly poignee: PoigneeOrchestrateur;
  readonly collecteur: CollecteurConversation;
}

export interface DetailConversation {
  readonly id: string;
  readonly titre: string;
  readonly evenements: readonly EvenementConversation[];
  readonly curseur: number;
  readonly genere: boolean;
  readonly active: boolean;
  readonly contextePct: number | null;
  /** Bloc en cours de frappe (streaming token par token), ou `null`. */
  readonly partiel: BlocPartiel | null;
}

export interface ResumeEvenements {
  readonly evenements: readonly EvenementConversation[];
  readonly curseur: number;
  readonly genere: boolean;
  readonly active: boolean;
  readonly contextePct: number | null;
  readonly partiel: BlocPartiel | null;
}

export interface EntreeListeConversation {
  readonly id: string;
  readonly titre: string;
  readonly creeA: number;
  readonly majA: number;
  readonly active: boolean;
  readonly contextePct: number | null;
}

export class ConversationIntrouvableError extends Error {
  constructor(id: string) {
    super(`conversation « ${id} » inconnue`);
    this.name = 'ConversationIntrouvableError';
  }
}

export class GestionnaireConversations {
  readonly #sessions = new Map<string, SessionActive>();
  readonly #demarrages = new Map<string, Promise<SessionActive>>();

  constructor(
    private readonly registre: Registre,
    private readonly construireSession: ConstruireSessionConversation,
  ) {}

  listerConversations(): readonly EntreeListeConversation[] {
    return this.registre.conversations.lister().map((c) => this.#entreeListe(c));
  }

  creer(titre?: string): Conversation {
    const propre = (titre ?? '').trim();
    const libelle = propre.length > 0 ? propre.slice(0, 120) : 'Nouvelle conversation';
    return this.registre.conversations.creer({ id: randomUUID(), titre: libelle });
  }

  renommer(id: string, titre: string): boolean {
    const propre = titre.trim();
    if (propre.length === 0) return false;
    return this.registre.conversations.renommer(id, propre.slice(0, 120));
  }

  /** Archive le fil ET ferme sa session si elle tourne. */
  archiver(id: string): boolean {
    this.fermer(id);
    return this.registre.conversations.archiver(id);
  }

  detail(id: string): DetailConversation | null {
    const conv = this.registre.conversations.lire(id);
    if (conv === null) return null;
    const evenements = this.registre.conversations.evenements(id);
    const curseur = evenements.length > 0 ? (evenements.at(-1)?.seq ?? 0) : 0;
    return {
      id: conv.id,
      titre: conv.titre,
      evenements,
      curseur,
      genere: this.#genere(id),
      active: this.#sessions.has(id),
      contextePct: this.#contextePct(id),
      partiel: this.#partiel(id),
    };
  }

  evenementsDepuis(id: string, depuis: number): ResumeEvenements | null {
    const conv = this.registre.conversations.lire(id);
    if (conv === null) return null;
    const evenements = this.registre.conversations.evenementsDepuis(id, depuis);
    const curseur = evenements.length > 0 ? (evenements.at(-1)?.seq ?? depuis) : depuis;
    return {
      evenements,
      curseur,
      genere: this.#genere(id),
      active: this.#sessions.has(id),
      contextePct: this.#contextePct(id),
      partiel: this.#partiel(id),
    };
  }

  /**
   * Envoie un message. Persiste l'événement opérateur, démarre la session au
   * besoin, puis enfile le message dans le flux SDK. `☠` NE bloque PAS jusqu'à la
   * réponse : `envoyerOperateur` ne fait qu'enfiler — la réponse remonte par le
   * streaming (événements). L'appelant HTTP rend la main tout de suite.
   */
  async envoyer(id: string, texte: string): Promise<void> {
    const propre = texte.trim();
    if (propre.length === 0) throw new RangeError('message vide');
    const conv = this.registre.conversations.lire(id);
    if (conv === null) throw new ConversationIntrouvableError(id);

    this.registre.conversations.ajouterEvenement({ conversationId: id, type: 'operateur', contenu: propre });
    const session = await this.#assurerSession(conv);
    session.collecteur.marquerEnvoi();
    await session.poignee.entree.envoyerOperateur(propre);
  }

  fermer(id: string): void {
    const session = this.#sessions.get(id);
    if (session === undefined) return;
    this.#sessions.delete(id);
    try {
      session.poignee.fermer();
    } catch (erreur) {
      log.error({ err: erreur, conversationId: id }, 'erreur en fermant une session — état mémoire déjà nettoyé');
    }
  }

  fermerTout(): void {
    for (const id of [...this.#sessions.keys()]) this.fermer(id);
  }

  #entreeListe(conv: Conversation): EntreeListeConversation {
    return {
      id: conv.id,
      titre: conv.titre,
      creeA: conv.creeA,
      majA: conv.majA,
      active: this.#sessions.has(conv.id),
      contextePct: this.#contextePct(conv.id),
    };
  }

  #genere(id: string): boolean {
    return this.#sessions.get(id)?.collecteur.genere ?? false;
  }

  #partiel(id: string): BlocPartiel | null {
    return this.#sessions.get(id)?.collecteur.partiel ?? null;
  }

  #contextePct(id: string): number | null {
    const ratio = this.#sessions.get(id)?.poignee.sentinelle.resume().derniereMesure?.ratio;
    return ratio === undefined || ratio === null ? null : Math.round(ratio * 100);
  }

  #assurerSession(conv: Conversation): Promise<SessionActive> {
    const existante = this.#sessions.get(conv.id);
    if (existante !== undefined) return Promise.resolve(existante);
    const enCours = this.#demarrages.get(conv.id);
    if (enCours !== undefined) return enCours;
    const promesse = this.#demarrer(conv.id).finally(() => this.#demarrages.delete(conv.id));
    this.#demarrages.set(conv.id, promesse);
    return promesse;
  }

  async #demarrer(conversationId: string): Promise<SessionActive> {
    const stockage = new StockageIdentiteConversation(this.registre, conversationId);
    const poignee = await this.construireSession(stockage, conversationId);
    // Fixe l'identité SDK réelle (idempotent — `ecrire` a pu déjà l'écrire au froid).
    this.registre.conversations.majSessionId(conversationId, poignee.sessionId);
    const collecteur = new CollecteurConversation(conversationId, this.registre.conversations);
    const session: SessionActive = { poignee, collecteur };
    this.#sessions.set(conversationId, session);
    void this.#lire(conversationId, poignee, collecteur);
    log.info({ conversationId, sessionId: poignee.sessionId }, 'session de conversation démarrée');
    return session;
  }

  /** Boucle de lecture UNIQUE de la session. À sa fin (fermeture/erreur), on oublie la session : le prochain envoi la reprendra (contexte via session_id). */
  async #lire(conversationId: string, poignee: PoigneeOrchestrateur, collecteur: CollecteurConversation): Promise<void> {
    try {
      for await (const message of poignee.query) {
        poignee.ingererMessage(message);
        collecteur.ingerer(message);
      }
      log.info({ conversationId }, 'flux de conversation terminé proprement');
    } catch (erreur) {
      log.error({ err: erreur, conversationId }, 'boucle de lecture de conversation interrompue');
      collecteur.marquerErreur('La session a été interrompue — renvoie ton message pour la reprendre.');
    } finally {
      this.#sessions.delete(conversationId);
    }
  }
}
