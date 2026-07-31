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
import { consigneNommage, normaliserTitre, TITRE_PAR_DEFAUT, type SourceTitre } from './titre-fil.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'gestionnaire-conversations' });

/** Un résumé peut demander une longue lecture du contexte : plafond généreux. */
const TIMEOUT_RESUME_MS = 180_000;

/**
 * `☠` Le résumé doit préserver ce qui rend la suite POSSIBLE, pas raconter la
 * conversation : décisions prises, état du parc, engagements en cours. Un résumé
 * narratif ferait perdre exactement ce dont l'orchestrateur a besoin après.
 */
const PROMPT_RESUME =
  'COMPACTION DEMANDÉE PAR LE HARNESS. Produis un résumé dense de cette conversation, destiné à ' +
  'toi-même : il remplacera tout ton contexte au prochain démarrage. Conserve les décisions prises, ' +
  "l'état du parc et des missions, les engagements en cours et les contraintes énoncées par " +
  "l'opérateur. Omets les politesses et les formulations. Réponds UNIQUEMENT par le résumé, sans " +
  'préambule ni commentaire.';

/** Nombre d'événements repris pour réamorcer après une rotation. */
const EVENEMENTS_REPRIS = 30;

/**
 * Reconstruit un contexte lisible à partir du fil DÉJÀ PERSISTÉ. `☠` On ne peut
 * pas demander de résumé à une session saturée — elle ne répond plus. Mais tout
 * l'historique est en base : c'est lui qui sert de mémoire de secours.
 */
export function transcriptPourReprise(
  evenements: readonly { readonly type: string; readonly contenu: string }[],
): string {
  const lignes: string[] = [];
  for (const e of evenements.slice(-EVENEMENTS_REPRIS)) {
    if (e.type === 'operateur') lignes.push(`Opérateur : ${e.contenu}`);
    else if (e.type === 'texte') lignes.push(`Toi : ${e.contenu}`);
    else if (e.type === 'compaction') lignes.push(`[résumé antérieur] ${e.contenu}`);
  }
  return lignes.join('\n\n').slice(0, 12_000);
}

/** Amorce injectée à la session qui suit une compaction. */
export function amorceApresCompaction(resume: string): string {
  return (
    'Reprise de cette conversation sur une session neuve (compaction ou changement ' +
    'de compte). Voici ce qui précède — cela remplace ton historique et fait autorité :\n\n' +
    resume +
    "\n\nAccuse réception en une phrase courte, puis attends l'opérateur."
  );
}

/** Construit la session SDK d'une conversation. Fourni par la composition (captures : serveur de contrôle, réconciliation, cwd…). */
export type ConstruireSessionConversation = (
  stockageIdentite: StockageIdentite,
  conversationId: string,
  /**
   * Force le mode `resume` au lieu de laisser le vérificateur trancher. Utilisé
   * comme filet quand le CLI refuse un démarrage froid parce qu'il connaît déjà
   * l'identifiant (`Session ID … is already in use`).
   */
  forcerReprise?: boolean,
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
  readonly compactions: number;
  /**
   * Dernier modèle et effort du fil. `☠` Sans eux, l'interface n'a AUCUN moyen
   * de rouvrir la conversation sur son propre réglage : elle retombe sur ses
   * défauts, en contradiction avec le message affiché juste au-dessus.
   */
  readonly modele: string | null;
  readonly effort: string | null;
  /** Bloc en cours de frappe (streaming token par token), ou `null`. */
  readonly partiel: BlocPartiel | null;
}

export interface ResumeEvenements {
  readonly evenements: readonly EvenementConversation[];
  readonly curseur: number;
  readonly genere: boolean;
  readonly active: boolean;
  readonly contextePct: number | null;
  readonly compactions: number;
  readonly partiel: BlocPartiel | null;
}

export interface EntreeListeConversation {
  readonly id: string;
  readonly titre: string;
  readonly creeA: number;
  readonly majA: number;
  readonly active: boolean;
  readonly contextePct: number | null;
  readonly compactions: number;
}

export class ConversationIntrouvableError extends Error {
  constructor(id: string) {
    super(`conversation « ${id} » inconnue`);
    this.name = 'ConversationIntrouvableError';
  }
}

/** Choix d'affichage de l'opérateur pour un envoi. Absents ⇒ on garde ceux du fil. */
export interface ChoixModele {
  readonly modele?: string | null;
  readonly effort?: string | null;
}

export class GestionnaireConversations {
  readonly #sessions = new Map<string, SessionActive>();
  readonly #demarrages = new Map<string, Promise<SessionActive>>();
  /**
   * Compactions demandées par l'orchestrateur lui-même, à exécuter à la FIN du
   * tour. `☠` Compacter pendant le tour reviendrait à fermer la session qui est
   * précisément en train d'exécuter l'outil — on scierait la branche.
   */
  readonly #compactionDemandee = new Set<string>();

  /**
   * Appelé par l'outil MCP `compacter_mon_contexte`. Ne compacte pas tout de
   * suite : arme la compaction pour la fin du tour courant.
   */
  demanderCompaction(id: string): { readonly arme: boolean; readonly detail: string } {
    if (this.registre.conversations.lire(id) === null) throw new ConversationIntrouvableError(id);
    if (!this.#sessions.has(id)) return { arme: false, detail: 'aucune session active — rien à compacter' };
    this.#compactionDemandee.add(id);
    return { arme: true, detail: 'compaction armée : elle s’exécutera dès la fin de cette réponse' };
  }

  constructor(
    private readonly registre: Registre,
    private readonly construireSession: ConstruireSessionConversation,
    /**
     * Bascule vers le compte suivant quand celui en cours est saturé. Rend
     * `true` s'il restait un compte de repli. Absent ⇒ pas de rotation : la
     * session reste muette, mais l'erreur est visible dans le fil.
     */
    private readonly rotationCompte?: () => boolean,
    /**
     * Remet à ce fil les faits du parc qu'il n'a pas encore reçus (migration 14).
     * Branché par la composition sur `ServiceNotifications.remettreEnAttente`.
     *
     * `☠` Pas de réentrance possible : le rattrapage passe par
     * `remettreNotification`, qui trouve la session déjà ouverte et ne relance
     * donc jamais `#assurerSession` en cascade.
     */
    private readonly rattraperNotifications?: (conversationId: string) => Promise<unknown>,
  ) {}

  listerConversations(): readonly EntreeListeConversation[] {
    return this.registre.conversations.lister().map((c) => this.#entreeListe(c));
  }

  creer(titre?: string): Conversation {
    const propre = normaliserTitre(titre ?? '');
    const libelle = propre.length > 0 ? propre : TITRE_PAR_DEFAUT;
    const conv = this.registre.conversations.creer({ id: randomUUID(), titre: libelle });
    // Un titre donné à la création vient d'un humain : il verrouille d'emblée.
    if (propre.length > 0) this.registre.conversations.renommer(conv.id, libelle, 'manuel');
    return conv;
  }

  /**
   * `source` par défaut à `'manuel'` : cette méthode est l'entrée de l'interface,
   * donc d'un humain. Le nommage automatique passe par l'outil MCP `nommer_fil`,
   * qui porte sa propre garde.
   */
  renommer(id: string, titre: string, source: SourceTitre = 'manuel'): boolean {
    const propre = normaliserTitre(titre);
    if (propre.length === 0) return false;
    return this.registre.conversations.renommer(id, propre, source);
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
      compactions: conv.compactions,
      modele: conv.modele,
      effort: conv.effort,
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
      compactions: conv.compactions,
      partiel: this.#partiel(id),
    };
  }

  /**
   * Envoie un message. Persiste l'événement opérateur, démarre la session au
   * besoin, puis enfile le message dans le flux SDK. `☠` NE bloque PAS jusqu'à la
   * réponse : `envoyerOperateur` ne fait qu'enfiler — la réponse remonte par le
   * streaming (événements). L'appelant HTTP rend la main tout de suite.
   */
  async envoyer(id: string, texte: string, choix: ChoixModele = {}): Promise<void> {
    const propre = texte.trim();
    if (propre.length === 0) throw new RangeError('message vide');
    const conv = this.registre.conversations.lire(id);
    if (conv === null) throw new ConversationIntrouvableError(id);

    // `☠` Le choix de l'opérateur n'était appliqué NULLE PART : l'UI envoyait
    // bien `model` et `effort`, la route les jetait, et la session tournait sur
    // sa constante. L'écran donnait donc le change sur un réglage sans effet
    // (constaté le 23/07). Le dernier choix retenu vaut aussi pour les envois
    // suivants qui ne précisent rien — sinon rouvrir un fil le ferait taire.
    const modele = choix.modele ?? conv.modele;
    const effort = choix.effort ?? conv.effort;

    this.registre.conversations.ajouterEvenement({
      conversationId: id,
      type: 'operateur',
      contenu: propre,
      modele,
      effort,
    });
    const session = await this.#assurerSession(conv);
    // `☠` AVANT le message de Chris, jamais après : l'orchestrateur doit savoir
    // qu'une équipe a fini quand il lui répond. L'inverse produit une réponse
    // fondée sur un état périmé, suivie d'une correction au tour d'après — ce
    // que le canal asynchrone existe précisément pour éviter.
    await this.#rattraper(id);
    await this.#appliquerChoixModele(session.poignee.query, id, modele, effort);
    if (choix.modele !== undefined || choix.effort !== undefined) {
      this.registre.conversations.poserModeleEffort(id, modele, effort);
    }
    session.collecteur.marquerEnvoi();
    session.collecteur.poserModeleEffort(modele, effort);
    await session.poignee.entree.envoyerOperateur(this.#avecConsigneNommage(id, conv, propre));
  }

  /**
   * Joint au message le rappel de nommage, tant que le fil n'a pas de titre.
   *
   * `☠` Uniquement sur ce qui part au SDK — l'évènement écrit au registre reste
   * le texte exact de Chris, sinon l'écran lui montrerait des mots qu'il n'a pas
   * tapés (H-66). Le rappel s'éteint tout seul dès que le titre existe.
   */
  #avecConsigneNommage(id: string, conv: Conversation, propre: string): string {
    const consigne = consigneNommage({
      source: conv.titreSource,
      messagesOperateur: this.registre.conversations.evenements(id).filter((e) => e.type === 'operateur').length,
    });
    return consigne === null ? propre : `${propre}\n\n${consigne}`;
  }

  /**
   * `☠` Ne laisse JAMAIS un rattrapage empêcher le message de partir. Un fait du
   * parc non remis est consultable dans l'interface et repassera au tour
   * suivant ; un message de Chris perdu, lui, ne revient pas.
   */
  async #rattraper(conversationId: string): Promise<void> {
    if (this.rattraperNotifications === undefined) return;
    try {
      await this.rattraperNotifications(conversationId);
    } catch (erreur) {
      log.warn({ err: erreur, conversationId }, 'rattrapage des notifications en échec — le message part quand même');
    }
  }

  /**
   * Applique modèle et effort à la session VIVANTE. `☠` Les deux ne sont
   * disponibles qu'en streaming input (doc du SDK) — c'est notre cas. Un échec
   * ne fait jamais perdre le message : on journalise et on envoie quand même,
   * plutôt que de refuser un tour pour un réglage d'affichage.
   */
  async #appliquerChoixModele(
    query: { setModel?: (m?: string) => Promise<void>; applyFlagSettings?: (s: Record<string, unknown>) => Promise<void> },
    conversationId: string,
    modele: string | null,
    effort: string | null,
  ): Promise<void> {
    try {
      if (modele !== null) await query.setModel?.(modele);
      if (effort !== null) await query.applyFlagSettings?.({ effortLevel: effort });
    } catch (erreur) {
      log.warn({ err: erreur, conversationId, modele, effort }, 'modèle/effort non appliqués — message envoyé quand même');
    }
  }

  /**
   * Compacte le contexte d'un fil. `☠` Mesuré sur le SDK 0.3.217 : aucune API de
   * compaction n'existe (ni méthode sur `Query`, ni control request ; `/compact`
   * envoyé dans le flux est traité comme du texte — le modèle y RÉPOND). La
   * compaction est donc faite ici : on demande un résumé à la session vivante,
   * on la ferme, et la suivante repart à froid amorcée par ce résumé.
   *
   * Sans session active il n'y a rien à résumer : on ne prétend pas avoir
   * compacté, on le dit.
   */
  async compacter(id: string): Promise<{ readonly compacte: boolean; readonly detail: string }> {
    const conv = this.registre.conversations.lire(id);
    if (conv === null) throw new ConversationIntrouvableError(id);
    const session = this.#sessions.get(id);
    if (session === undefined) {
      return { compacte: false, detail: 'aucune session active sur ce fil — rien à compacter' };
    }
    if (session.collecteur.genere) {
      return { compacte: false, detail: 'une réponse est en cours — attends la fin avant de compacter' };
    }

    let resume: string;
    try {
      const attente = session.collecteur.ouvrirTourInterne(TIMEOUT_RESUME_MS);
      await session.poignee.entree.envoyerOperateur(PROMPT_RESUME);
      resume = await attente;
    } catch (erreur) {
      log.error({ err: erreur, conversationId: id }, 'échec de la demande de résumé — contexte laissé intact');
      return { compacte: false, detail: 'le résumé n’a pas abouti — contexte laissé intact, rien n’a été perdu' };
    }
    if (resume.trim().length === 0) {
      return { compacte: false, detail: 'résumé vide — contexte laissé intact' };
    }

    // L'ordre compte : on ferme AVANT d'écrire, pour qu'aucun message tardif de
    // l'ancienne session ne vienne se mêler au fil après la bascule.
    this.fermer(id);
    this.registre.conversations.enregistrerCompaction(id, resume);
    log.info({ conversationId: id, tailleResume: resume.length }, 'contexte compacté');
    return { compacte: true, detail: 'contexte compacté — la suite repart sur un résumé' };
  }

  /**
   * Une session tourne-t-elle déjà pour ce fil ? `☠` Question de COÛT, pas
   * d'existence : c'est elle qui distingue une remise gratuite d'un réveil qui
   * démarre une session et se met à consommer du quota en continu.
   */
  estActive(id: string): boolean {
    return this.#sessions.has(id);
  }

  /**
   * Remet un fait du parc à l'orchestrateur (migration 14).
   *
   * `☠` Type d'évènement `notification`, JAMAIS `operateur` : « une équipe a
   * terminé » n'est pas une parole de Chris, et H-66 interdit de le lui faire
   * porter. L'interface en dépend aussi — un fait du harness ne doit pas
   * s'afficher comme un message de l'opérateur dans le fil.
   *
   * `☠` Ne touche NI au modèle NI à l'effort du fil, à la différence d'`envoyer`.
   * Une notification arrivant à 3 h du matin n'a aucune raison de redéfinir le
   * réglage que Chris a choisi la veille.
   */
  async remettreNotification(id: string, texte: string): Promise<void> {
    const propre = texte.trim();
    if (propre.length === 0) throw new RangeError('notification vide');
    const conv = this.registre.conversations.lire(id);
    if (conv === null) throw new ConversationIntrouvableError(id);

    this.registre.conversations.ajouterEvenement({
      conversationId: id,
      type: 'notification',
      contenu: propre,
      modele: conv.modele,
      effort: conv.effort,
    });
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
      compactions: conv.compactions,
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
    const avant = this.registre.conversations.lire(conversationId);
    const stockage = new StockageIdentiteConversation(this.registre, conversationId);
    const poignee = await this.#construireAvecFilet(stockage, conversationId);
    // Fixe l'identité SDK réelle (idempotent — `ecrire` a pu déjà l'écrire au froid).
    this.registre.conversations.majSessionId(conversationId, poignee.sessionId);
    const collecteur = new CollecteurConversation(conversationId, this.registre.conversations);
    const session: SessionActive = { poignee, collecteur };
    this.#sessions.set(conversationId, session);
    void this.#lire(conversationId, poignee, collecteur);

    // `☠` Session neuve APRÈS une compaction : elle ne sait rien. On la réamorce
    // avec le résumé, en tour interne — sinon l'opérateur verrait le harness
    // recoller son propre contexte dans le fil.
    // `☠` Condition sur le RÉSUMÉ, pas sur le compteur de compactions : une
    // rotation de compte pose aussi un contexte de reprise sans compacter.
    const resume = avant?.resumeContexte;
    if (avant !== null && typeof resume === 'string' && resume.length > 0) {
      try {
        const attente = collecteur.ouvrirTourInterne(TIMEOUT_RESUME_MS);
        await poignee.entree.envoyerOperateur(amorceApresCompaction(resume));
        await attente;
        log.info({ conversationId }, 'session réamorcée avec le résumé de compaction');
      } catch (erreur) {
        // Le fil reste utilisable : l'orchestrateur aura simplement perdu le fil
        // de l'avant-compaction. On le dit dans les logs, on ne bloque pas.
        log.error({ err: erreur, conversationId }, 'réamorçage après compaction en échec — session démarrée sans résumé');
      }
    }

    log.info({ conversationId, sessionId: poignee.sessionId }, 'session de conversation démarrée');
    return session;
  }

  /**
   * `☠` Filet sur l'identité de session. Le vérificateur peut se tromper (il
   * répond sur des faits de système de fichiers) : s'il conclut « inconnue »
   * alors que le CLI la connaît, le démarrage froid échoue sur
   * `Session ID … is already in use`. Plutôt que de rendre le fil définitivement
   * inutilisable — ce qui est arrivé en production le 2026-07-23 —, on retente
   * une fois en reprise explicite.
   */
  async #construireAvecFilet(stockage: StockageIdentite, conversationId: string): Promise<PoigneeOrchestrateur> {
    try {
      return await this.construireSession(stockage, conversationId);
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      // Session inconnue du compte courant (rotation, transcript purgé) : on
      // oublie l'identité et on repart à froid plutôt que de rester bloqué.
      if (/no conversation found/i.test(message)) {
        log.warn({ conversationId }, 'session introuvable sur ce compte — redémarrage à froid');
        this.registre.conversations.oublierSession(conversationId);
        return this.construireSession(stockage, conversationId);
      }
      if (!/already in use/i.test(message)) throw erreur;
      log.warn({ conversationId }, 'identifiant de session déjà pris — nouvelle tentative en reprise explicite');
      return this.construireSession(stockage, conversationId, true);
    }
  }

  /** Boucle de lecture UNIQUE de la session. À sa fin (fermeture/erreur), on oublie la session : le prochain envoi la reprendra (contexte via session_id). */
  async #lire(conversationId: string, poignee: PoigneeOrchestrateur, collecteur: CollecteurConversation): Promise<void> {
    try {
      for await (const message of poignee.query) {
        poignee.ingererMessage(message);
        collecteur.ingerer(message);
        // `☠` Compte saturé : la session ne répondra plus. On la ferme pour que
        // le prochain envoi reparte sur le compte de repli — sinon l'orchestrateur
        // reste muet et rien n'explique pourquoi (vécu le 23/07).
        if (collecteur.sature) {
          const bascule = this.rotationCompte?.() ?? false;
          // `☠` La session appartient au compte qui l'a créée : la reprendre sur
          // le compte de repli échoue (« No conversation found with session ID »).
          // On oublie l'identité pour repartir à froid sur le nouveau compte.
          if (bascule) {
            const fil = this.registre.conversations.evenements(conversationId);
            const transcript = transcriptPourReprise(fil);
            if (transcript.length > 0) this.registre.conversations.poserResumeContexte(conversationId, transcript);
            else this.registre.conversations.oublierSession(conversationId);
          }
          log.warn({ conversationId, bascule }, 'compte de l’orchestrateur saturé — session fermée');
          collecteur.marquerErreur(
            bascule
              ? 'Compte saturé — bascule sur le compte de repli. Renvoie ton message.'
              : 'Compte saturé et aucun compte de repli disponible sur le Pi.',
          );
          this.fermer(conversationId);
          break;
        }
        // Fin de tour : c'est le seul moment sûr pour honorer une compaction que
        // l'orchestrateur a demandée lui-même pendant sa réponse.
        if (message.type === 'result' && this.#compactionDemandee.delete(conversationId)) {
          void this.compacter(conversationId).catch((erreur: unknown) => {
            log.error({ err: erreur, conversationId }, 'compaction demandée par l’orchestrateur en échec');
          });
        }
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
