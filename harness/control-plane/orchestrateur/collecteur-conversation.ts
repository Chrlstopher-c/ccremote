/**
 * Responsabilité : transformer le flux SDK d'UNE session orchestrateur en
 * événements affichables, avec un VRAI streaming token par token.
 *
 * `☠ LA CLÉ` — la session est composée avec `includePartialMessages: true` : le
 * SDK émet des `stream_event` (deltas de texte et de réflexion) AVANT le message
 * `assistant` complet. Une première version ne lisait que le message complet et
 * jetait tous les deltas : la réponse « tombait » d'un bloc à l'écran. Le
 * streaming ne se règle pas côté interface, il se lit ICI.
 *
 * `☠` Deux régimes, jamais les deux à la fois (sinon chaque bloc serait persisté
 * en double) : si un `stream_event` a été vu pendant le tour, les blocs sont
 * persistés à leur `content_block_stop` et le message `assistant` complet est
 * IGNORÉ ; sinon (SDK sans partiels) on retombe sur le message complet. Le
 * drapeau `#streameCeTour` porte ce choix.
 *
 * `☠` La persistance se fait au BLOC TERMINÉ, jamais au token : un INSERT par
 * token noierait SQLite. Le bloc en cours vit en mémoire (`#partiel`) et est
 * servi tel quel à l'interface, qui le voit grandir à chaque sondage.
 *
 * `☠` Ne lève JAMAIS : appelé depuis la boucle de lecture unique de la session.
 * Une exception ici tuerait la boucle et figerait la conversation.
 */

import { annonceSaturation } from '../../shared/saturation-compte.ts';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { DepotConversations } from '../registre/index.ts';
import type { TypeEvenementConversation } from '../registre/index.ts';
import { appelsDe, resultatsDe } from './resultats-outils.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'collecteur-conversation' });

interface BlocContenu {
  readonly type?: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly name?: string;
}

/** Bloc en cours de construction, servi à l'interface avant d'être persisté. */
export interface BlocPartiel {
  readonly type: TypeEvenementConversation;
  readonly contenu: string;
}

/**
 * Sonde de `stream_event`. `event` est un type profond de l'API Beta
 * (`BetaRawMessageStreamEvent`) : on sonde une forme large, jamais castée
 * précisément — même convention que `observabilite/arbre-flux.ts`.
 */
interface SondeStream {
  readonly event?: {
    readonly type?: string;
    readonly content_block?: { readonly type?: string; readonly name?: string; readonly id?: string };
    readonly delta?: { readonly type?: string; readonly text?: string; readonly thinking?: string };
  };
}

interface BlocPersistable {
  readonly type: TypeEvenementConversation;
  readonly contenu: string;
  /** Appels d'outils uniquement — clé d'appariement avec le résultat à venir. */
  readonly toolUseId?: string | null;
  readonly detail?: string | null;
}

/**
 * Extrait les blocs typés d'un message assistant COMPLET (régime sans partiels).
 *
 * `☠` UNE seule passe, dans l'ordre du message. Une première version traitait les
 * appels d'outils dans une boucle séparée : les outils remontaient alors en tête
 * du fil, avant les réflexions qui les avaient motivés. Un fil réordonné se relit
 * comme un raisonnement qui n'a jamais eu lieu.
 */
function blocsAssistant(message: SDKMessage): BlocPersistable[] {
  if (message.type !== 'assistant') return [];
  const contenu = (message as { message?: { content?: unknown } }).message?.content;
  if (typeof contenu === 'string') {
    return contenu.trim().length > 0 ? [{ type: 'texte', contenu }] : [];
  }
  if (!Array.isArray(contenu)) return [];
  const sortie: BlocPersistable[] = [];
  for (const brut of contenu as BlocContenu[]) {
    if (brut.type === 'text' && typeof brut.text === 'string' && brut.text.length > 0) {
      sortie.push({ type: 'texte', contenu: brut.text });
    } else if (brut.type === 'thinking' && typeof brut.thinking === 'string' && brut.thinking.length > 0) {
      sortie.push({ type: 'reflexion', contenu: brut.thinking });
    } else if (brut.type === 'redacted_thinking') {
      sortie.push({ type: 'reflexion', contenu: '[réflexion masquée par le modèle]' });
    } else if (brut.type === 'tool_use' && typeof brut.name === 'string') {
      const [appel] = appelsDe({ message: { content: [brut] } });
      sortie.push({
        type: 'outil',
        contenu: brut.name,
        toolUseId: appel?.toolUseId ?? null,
        detail: appel?.detail ?? null,
      });
    }
  }
  return sortie;
}

/** Traduit le type de bloc SDK vers notre vocabulaire d'événement. */
function typeDepuisBloc(typeBloc: string | undefined): TypeEvenementConversation | null {
  if (typeBloc === 'text') return 'texte';
  if (typeBloc === 'thinking' || typeBloc === 'redacted_thinking') return 'reflexion';
  if (typeBloc === 'tool_use') return 'outil';
  return null;
}

/**
 * `☠` Motifs observés en RÉEL (23/07) : le CLI annonce la limite en clair et la
 * session devient muette. Sans détection, l'orchestrateur ne répond plus et rien
 * n'explique pourquoi — l'opérateur croit à une panne du harness.
 */
export class CollecteurConversation {
  #genere = false;
  #streameCeTour = false;
  #partiel: { type: TypeEvenementConversation; contenu: string } | null = null;
  /** Tour interne (compaction) : rien n'est persisté, le texte est capté à part. */
  #muet = false;
  #sature = false;
  #capture = '';
  #finTour: ((texte: string) => void) | null = null;

  constructor(
    private readonly conversationId: string,
    private readonly depot: DepotConversations,
  ) {}

  /**
   * Modèle et effort du tour en cours, estampillés sur CHAQUE évènement produit.
   *
   * `☠` Sans cette attribution, une conversation où l'opérateur change de modèle
   * en cours de route devient illisible : rien ne dit quelle réponse vient de
   * quel modèle ni de quel niveau de raisonnement (friction remontée le 23/07).
   */
  #modele: string | null = null;
  #effort: string | null = null;

  poserModeleEffort(modele: string | null, effort: string | null): void {
    this.#modele = modele;
    this.#effort = effort;
  }

  /** L'opérateur vient d'envoyer : un tour de génération commence. */
  marquerEnvoi(): void {
    this.#genere = true;
    this.#streameCeTour = false;
    this.#partiel = null;
    this.#muet = false;
  }

  /**
   * Referme l'état de génération après une interruption demandée par l'opérateur.
   *
   * `☠` Le bloc partiel est ABANDONNÉ, jamais persisté : une réflexion coupée au
   * milieu d'une phrase, écrite dans le fil, s'y relirait ensuite comme une pensée
   * complète.
   *
   * `☠` Et `#genere` doit retomber ICI : le SDK n'émet pas nécessairement de
   * message de fin sur un tour coupé. Sans ça, l'interface reste bloquée sur « en
   * cours » — donc sur un bouton d'envoi désactivé et un fil qu'on croit vivant.
   */
  marquerInterruption(): void {
    this.#partiel = null;
    this.#genere = false;
    this.#streameCeTour = false;
  }

  /**
   * Ouvre un tour INTERNE (compaction) : rien n'est écrit dans le fil, et la
   * promesse rend le texte produit. `☠` Sans ce mode, la demande de résumé et sa
   * réponse apparaîtraient dans la conversation de l'opérateur — qui verrait le
   * harness se parler à lui-même.
   */
  ouvrirTourInterne(timeoutMs: number): Promise<string> {
    this.#genere = true;
    this.#streameCeTour = false;
    this.#partiel = null;
    this.#muet = true;
    this.#capture = '';
    return new Promise<string>((resoudre, rejeter) => {
      const minuterie = setTimeout(() => {
        this.#finTour = null;
        this.#muet = false;
        this.#genere = false;
        rejeter(new Error(`aucune réponse au tour interne en ${timeoutMs} ms`));
      }, timeoutMs);
      this.#finTour = (texte: string): void => {
        clearTimeout(minuterie);
        resoudre(texte);
      };
    });
  }

  get genere(): boolean {
    return this.#genere;
  }

  /** Le compte de cette session a annoncé une limite atteinte : il faut tourner. */
  get sature(): boolean {
    return this.#sature;
  }

  /**
   * Le bloc en cours de frappe, ou `null`. Lu par l'API à chaque sondage.
   * `☠` Masqué pendant un tour interne : sinon l'opérateur verrait le résumé de
   * compaction s'écrire dans son fil, comme si le harness lui parlait.
   */
  get partiel(): BlocPartiel | null {
    return this.#muet ? null : this.#partiel;
  }

  /**
   * Poussé par la boucle de lecture unique, pour CHAQUE message. Ne lève jamais.
   */
  ingerer(message: SDKMessage): void {
    try {
      if (message.type === 'stream_event') {
        this.#ingererPartiel(message);
        return;
      }
      if (message.type === 'assistant') {
        // `☠` Les PARAMÈTRES d'appel ne sont complets qu'ici : pendant le
        // streaming, `content_block_start` donne le nom et l'id, l'`input`
        // n'arrive qu'ensuite par deltas. On complète donc l'appel déjà écrit,
        // sans le dupliquer.
        this.#completerAppels(message);
        // `☠` Le reste a déjà été persisté bloc par bloc : ne pas doubler.
        // MESURÉ le 07/08 avec une sonde temporaire : ce qui est jeté ici n'est
        // QUE du type `outil`, jamais de la réflexion. Ce chemin n'est donc pas
        // la cause des réflexions manquantes — c'était `thinking.display`, côté
        // options. L'hypothèse « le régime streamé jette le thinking » est
        // réfutée, elle n'a pas à être ré-explorée.
        if (this.#streameCeTour) return;
        for (const bloc of blocsAssistant(message)) {
          this.#persister(bloc.type, bloc.contenu, bloc.toolUseId ?? null, bloc.detail ?? null);
        }
        return;
      }
      // `☠` Les `tool_result` arrivent dans des messages de type `user` — c'est
      // ainsi que l'API modélise le retour d'un outil. Un collecteur qui ne
      // regardait que les messages `assistant` ne pouvait STRUCTURELLEMENT pas
      // les voir : c'est pourquoi aucun résultat n'a jamais été capté.
      if (message.type === 'user') {
        this.#completerResultats(message);
        return;
      }
      if (message.type === 'system') {
        const sonde = message as unknown as { subtype?: string; content?: string; text?: string };
        const texte = sonde.content ?? sonde.text ?? '';
        if (annonceSaturation(texte)) {
          this.#sature = true;
          this.#persister('erreur', `Compte saturé : ${texte.slice(0, 200)}`);
        }
        return;
      }
      if (message.type === 'result') this.#terminerTour(message);
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId }, 'échec de traitement d’un message — boucle préservée');
    }
  }

  /** La boucle de lecture s'est arrêtée sur une erreur : figer proprement. */
  marquerErreur(raison: string): void {
    this.#genere = false;
    this.#partiel = null;
    try {
      this.depot.ajouterEvenement({
        conversationId: this.conversationId,
        type: 'erreur',
        contenu: raison,
        modele: this.#modele,
        effort: this.#effort,
      });
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId }, 'échec de persistance de l’erreur terminale');
    }
  }

  /** Deltas du SDK : début de bloc, tokens, fin de bloc. */
  #ingererPartiel(message: SDKMessage): void {
    const evenement = (message as unknown as SondeStream).event;
    if (evenement === undefined) return;
    this.#streameCeTour = true;

    if (evenement.type === 'content_block_start') {
      const type = typeDepuisBloc(evenement.content_block?.type);
      if (type === null) return;
      // Un `tool_use` n'a pas de delta de texte : son nom est connu dès le début
      // et se persiste immédiatement — c'est le « commentaire pendant la
      // génération » que l'opérateur voit défiler.
      if (type === 'outil') {
        const nom = evenement.content_block?.name;
        // `☠` L'`id` est capté ICI, seul endroit où il transite pendant le
        // streaming. Sans lui, l'appel est écrit sans clé d'appariement et son
        // résultat, qui arrive au message suivant, n'a plus rien à rejoindre.
        const id = evenement.content_block?.id;
        if (typeof nom === 'string' && nom.length > 0) {
          this.#persister('outil', nom, typeof id === 'string' ? id : null);
        }
        return;
      }
      this.#partiel = { type, contenu: '' };
      return;
    }

    if (evenement.type === 'content_block_delta') {
      const delta = evenement.delta;
      const morceau = delta?.type === 'text_delta' ? delta.text : delta?.type === 'thinking_delta' ? delta.thinking : undefined;
      if (typeof morceau !== 'string' || morceau.length === 0) return;
      const type: TypeEvenementConversation = delta?.type === 'thinking_delta' ? 'reflexion' : 'texte';
      // Un delta sans `content_block_start` observé reste affichable : on ouvre
      // le bloc à la volée plutôt que de perdre du texte.
      if (this.#partiel === null || this.#partiel.type !== type) this.#partiel = { type, contenu: '' };
      this.#partiel = { type, contenu: this.#partiel.contenu + morceau };
      return;
    }

    if (evenement.type === 'content_block_stop') this.#finaliserPartiel();
  }

  #finaliserPartiel(): void {
    const partiel = this.#partiel;
    this.#partiel = null;
    if (partiel === null || partiel.contenu.trim().length === 0) return;
    this.#persister(partiel.type, partiel.contenu);
  }

  #terminerTour(message: SDKMessage): void {
    this.#finaliserPartiel();
    this.#genere = false;
    this.#streameCeTour = false;
    if (this.#muet) {
      const rendre = this.#finTour;
      const texte = this.#capture;
      this.#muet = false;
      this.#finTour = null;
      this.#capture = '';
      rendre?.(texte.trim());
      return;
    }
    const subtype = (message as { subtype?: string }).subtype;
    if (subtype !== undefined && subtype !== 'success') {
      this.#persister('erreur', `Le tour s'est terminé sur une erreur (${subtype}).`);
      return;
    }
    this.#persister('resultat', '');
  }

  /**
   * Complète les paramètres des appels déjà écrits pendant le streaming.
   * `☠` Ne lève jamais : un détail manquant dégrade l'affichage, il ne doit
   * jamais interrompre la boucle de lecture du fil.
   */
  #completerAppels(message: SDKMessage): void {
    if (this.#muet) return;
    for (const appel of appelsDe(message)) {
      // Sans identifiant, rien à compléter : l'appel reste affiché tel quel.
      if (appel.toolUseId === null || appel.detail.length === 0) continue;
      try {
        this.depot.completerDetailOutil(appel.toolUseId, appel.detail);
      } catch (erreur) {
        log.error({ err: erreur, toolUseId: appel.toolUseId }, 'échec d’écriture du détail d’un appel');
      }
    }
  }

  /**
   * Pose le résultat de chaque outil retourné, apparié par `tool_use_id`.
   *
   * `☠` Un résultat sans appel correspondant est IGNORÉ en silence, et c'est
   * voulu : il vient d'un tour antérieur à la migration 21, ou d'un tour interne
   * qui n'écrit rien dans le fil. En fabriquer un serait pire que l'absence.
   */
  #completerResultats(message: SDKMessage): void {
    if (this.#muet) return;
    for (const resultat of resultatsDe(message)) {
      try {
        // `☠` L'échec est MARQUÉ dans le contenu : sans ça, un outil qui a
        // planté s'affiche comme un outil qui a répondu, et on relit le fil en
        // croyant que l'information a bien été obtenue.
        const marque = resultat.erreur ? `[ÉCHEC DE L’OUTIL]\n${resultat.contenu}` : resultat.contenu;
        this.depot.completerResultatOutil(resultat.toolUseId, marque);
      } catch (erreur) {
        log.error({ err: erreur, toolUseId: resultat.toolUseId }, 'échec d’écriture du résultat d’un outil');
      }
    }
  }

  #persister(
    type: TypeEvenementConversation,
    contenu: string,
    toolUseId: string | null = null,
    detail: string | null = null,
  ): void {
    // `☠` Mesuré le 23/07 : la limite N'ARRIVE PAS en message système, mais en
    // TEXTE ASSISTANT (« You've hit your monthly spend limit … »). Ne la chercher
    // que dans les messages système, c'était ne jamais la voir.
    if (type === 'texte' && !this.#sature && annonceSaturation(contenu)) {
      this.#sature = true;
    }
    // Tour interne : on capte le texte, on n'écrit rien dans le fil.
    if (this.#muet) {
      if (type === 'texte') this.#capture += contenu;
      return;
    }
    try {
      this.depot.ajouterEvenement({
        conversationId: this.conversationId,
        type,
        contenu,
        modele: this.#modele,
        effort: this.#effort,
        toolUseId,
        detail,
      });
    } catch (erreur) {
      log.error({ err: erreur, conversationId: this.conversationId, type }, 'échec de persistance d’un événement');
    }
  }
}
