/**
 * Responsabilité : reconstruire l'arbre d'exécution TEMPS RÉEL depuis le flux
 * SDK (E.2.1/E.2.2, mission M-50). Source best-effort (H-72.3) — voir
 * `types.ts` pour la justification de la séparation flux/store.
 *
 * ☠ Ce module n'ouvre AUCUNE lecture de `Query` lui-même : il est nourri par
 * l'unique consommateur déjà en place (`superviseur/superviseur-workers.ts`,
 * `#surveillerResultats`). Un second lecteur du même `Query` volerait des
 * messages (règle du dépôt, H « un seul consommateur par Query »). Il
 * n'appelle non plus JAMAIS `getContextUsage()` ni aucun appel de contrôle —
 * piège mesuré de H-72.3 : entrelacé avec la lecture du flux, ça fait perdre
 * les messages des sous-agents.
 *
 * Piège d'outil (H-72.3) : le nom de l'outil de délégation est `Agent`, pas
 * `Task` — un détecteur qui cherche `Task` compte zéro délégation.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { observabiliteLogger as journal } from './logger.ts';
import { RACINE_FLUX, type BlocPartielFlux, type Granularite, type LigneTravailFlux, type StatutLigne } from './types.ts';

/** Nom réel de l'outil de délégation (⚠ piège mesuré H-72.3 : ce n'est PAS `Task`). */
export const OUTIL_DELEGATION = 'Agent';

interface LigneInterne {
  parentId: string | null;
  profondeur: 0 | 1;
  sousAgentType: string | null;
  description: string | null;
  statut: StatutLigne;
  dernierResume: string | null;
  dernierOutil: string | null;
  texteAccumule: string;
  dispatcheeA: number;
  majA: number;
  vueAvecContenu: boolean;
  /**
   * Bloc en cours de frappe, ou `null` quand la ligne n'écrit rien à cet
   * instant. `☠` Distinct de `texteAccumule`, qui ne redescend JAMAIS : celui-ci
   * se vide à `content_block_stop` et à la fin du tour. Servir le seul
   * `texteAccumule` ferait afficher « en train d'écrire » la queue du dernier
   * message pendant tout le temps où l'agent ne fait rien.
   */
  partiel: BlocPartielFlux | null;
}

/** Sondes structurelles — jamais castées vers un type SDK précis (même motif que `audit-permissions`). */
interface BlocContenuSonde {
  readonly type?: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly tool_use_id?: string;
}

/**
 * Sonde d'un `stream_event`. `event` est un type profond de l'API Beta
 * (`BetaRawMessageStreamEvent`) : forme large, jamais castée précisément —
 * même convention que `orchestrateur/collecteur-conversation.ts`.
 */
type DeltaStream = { readonly type?: string; readonly text?: string; readonly thinking?: string } | undefined;

interface SondeStream {
  readonly event?: {
    readonly type?: string;
    readonly content_block?: { readonly type?: string };
    readonly delta?: DeltaStream;
  };
}

/** Type de bloc SDK ⇒ vocabulaire du partiel. `null` : rien à afficher (`tool_use`). */
function typePartiel(typeBloc: string | undefined): BlocPartielFlux['type'] | null {
  if (typeBloc === 'text') return 'texte';
  if (typeBloc === 'thinking' || typeBloc === 'redacted_thinking') return 'reflexion';
  return null;
}

interface HorlogeArbre {
  maintenant(): number;
}

const HORLOGE_REELLE: HorlogeArbre = { maintenant: () => Date.now() };

/** Un fragment issu du flux, déjà classé par granularité (E.2.1) — sortie d'`ingerer()`. */
export interface FragmentObserve {
  readonly ligneId: string;
  readonly granularite: Granularite;
  readonly texte: string | null;
}

export class ArbreFluxTempsReel {
  readonly #lignes = new Map<string, LigneInterne>();
  readonly #horloge: HorlogeArbre;

  constructor(horloge: HorlogeArbre = HORLOGE_REELLE) {
    this.#horloge = horloge;
    this.#lignes.set(RACINE_FLUX, this.#ligneVide(null, 0));
  }

  /**
   * Point d'ingestion unique — appelé par le superviseur pour CHAQUE message
   * du flux qu'il lit déjà (jamais un second lecteur). Ne lève jamais.
   */
  ingerer(message: SDKMessage): readonly FragmentObserve[] {
    try {
      return this.#ingererSansGarde(message);
    } catch (erreur) {
      journal.error({ erreur, type: message.type }, 'ingestion_flux_echouee');
      return [];
    }
  }

  lignes(): readonly LigneTravailFlux[] {
    return [...this.#lignes.entries()].map(([id, l]) => this.#vue(id, l));
  }

  ligne(id: string): LigneTravailFlux | undefined {
    const interne = this.#lignes.get(id);
    return interne === undefined ? undefined : this.#vue(id, interne);
  }

  /**
   * Le bloc que cette ligne est en train de frapper, ou `null` si elle n'écrit
   * rien à cet instant. `null` est une information : « l'agent ne parle pas »,
   * jamais « on ne sait pas ».
   */
  partielDe(ligneId: string): BlocPartielFlux | null {
    return this.#lignes.get(ligneId)?.partiel ?? null;
  }

  /** (a) Lignes réellement dispatchées depuis la racine — hors racine elle-même. */
  sousAgentsDispatches(): number {
    return [...this.#lignes.values()].filter((l) => l.parentId !== null).length;
  }

  /** Un contenu quelconque (texte, résumé, outil) a été vu au moins une fois. */
  sousAgentsAvecContenu(): number {
    return [...this.#lignes.values()].filter((l) => l.parentId !== null && l.vueAvecContenu).length;
  }

  #ingererSansGarde(message: SDKMessage): FragmentObserve[] {
    if (message.type === 'assistant' || message.type === 'user') return this.#ingererTour(message);
    if (message.type === 'stream_event') return this.#ingererJetonPartiel(message);
    if (message.type === 'system' && 'subtype' in message) return this.#ingererBanniereTache(message);
    // `☠` Fin de tour : plus RIEN n'est en cours de frappe, sur aucune ligne. Sans
    // ce balayage, un tour coupé avant son `content_block_stop` (interruption,
    // erreur, saturation) laisserait un partiel figé que l'écran présenterait
    // indéfiniment comme du texte en train de s'écrire.
    if (message.type === 'result') {
      for (const ligne of this.#lignes.values()) ligne.partiel = null;
    }
    return [];
  }

  #ingererTour(message: SDKMessage & { type: 'assistant' | 'user' }): FragmentObserve[] {
    const ligneId = message.parent_tool_use_id ?? RACINE_FLUX;
    const ligne = this.#ligneOuCreation(ligneId, message.parent_tool_use_id === null ? null : RACINE_FLUX);
    const blocs = this.#blocsDuMessage(message);
    const fragments: FragmentObserve[] = [];
    for (const bloc of blocs) {
      if (bloc.type === 'text' && typeof bloc.text === 'string' && bloc.text.length > 0) {
        ligne.texteAccumule += bloc.text;
        ligne.vueAvecContenu = true;
        fragments.push({ ligneId, granularite: 'activite_sous_agent', texte: bloc.text });
      }
      if (bloc.type === 'tool_use' && bloc.name === OUTIL_DELEGATION && typeof bloc.id === 'string') {
        this.#dispatcherSousAgent(bloc.id, ligneId);
      }
      if (bloc.type === 'tool_result' && typeof bloc.tool_use_id === 'string') {
        this.#terminerLigne(bloc.tool_use_id, 'terminee');
      }
    }
    // Le message COMPLET est arrivé : ses blocs sont tous fermés, quoi qu'ait
    // livré le flux de deltas. Filet de sécurité du `content_block_stop`.
    ligne.partiel = null;
    ligne.majA = this.#horloge.maintenant();
    return fragments;
  }

  #ingererJetonPartiel(message: SDKMessage & { type: 'stream_event' }): FragmentObserve[] {
    const ligneId = message.parent_tool_use_id ?? RACINE_FLUX;
    const evenement = (message as unknown as SondeStream).event;
    if (evenement === undefined) return [];
    if (evenement.type === 'content_block_start') {
      this.#ouvrirPartiel(ligneId, typePartiel(evenement.content_block?.type));
      return [];
    }
    if (evenement.type === 'content_block_stop') {
      const ligne = this.#lignes.get(ligneId);
      if (ligne !== undefined) ligne.partiel = null;
      return [];
    }
    if (evenement.type !== 'content_block_delta') return [];
    return this.#appliquerDelta(ligneId, evenement.delta);
  }

  /** Un bloc SANS texte (`tool_use`) ferme le partiel : rien n'y est frappé. */
  #ouvrirPartiel(ligneId: string, type: BlocPartielFlux['type'] | null): void {
    if (type === null) {
      const existante = this.#lignes.get(ligneId);
      if (existante !== undefined) existante.partiel = null;
      return;
    }
    const ligne = this.#ligneOuCreation(ligneId, ligneId === RACINE_FLUX ? null : RACINE_FLUX);
    ligne.partiel = { type, contenu: '' };
    ligne.majA = this.#horloge.maintenant();
  }

  /**
   * `☠` Seul le TEXTE alimente `texteAccumule` et la diffusion. Y verser la
   * réflexion changerait le sens d'un champ lu ailleurs (résumés, complétude)
   * et ferait apparaître le raisonnement du lead dans le fil d'activité. Le
   * partiel, lui, porte les deux : c'est justement pendant une longue réflexion
   * que l'écran doit montrer que quelque chose se passe.
   */
  #appliquerDelta(ligneId: string, delta: DeltaStream): FragmentObserve[] {
    const texte = delta?.type === 'text_delta' ? delta.text : undefined;
    const morceau = texte ?? (delta?.type === 'thinking_delta' ? delta.thinking : undefined);
    if (typeof morceau !== 'string' || morceau.length === 0) return [];
    const ligne = this.#ligneOuCreation(ligneId, ligneId === RACINE_FLUX ? null : RACINE_FLUX);
    const type: BlocPartielFlux['type'] = texte === undefined ? 'reflexion' : 'texte';
    // Un delta sans `content_block_start` observé reste affichable : le bloc
    // s'ouvre à la volée plutôt que de perdre ce qui est en train de s'écrire.
    const dejaLa = ligne.partiel?.type === type ? ligne.partiel.contenu : '';
    ligne.partiel = { type, contenu: dejaLa + morceau };
    ligne.majA = this.#horloge.maintenant();
    if (texte === undefined) return [];
    ligne.texteAccumule += morceau;
    ligne.vueAvecContenu = true;
    return [{ ligneId, granularite: 'tokens', texte: morceau }];
  }

  #ingererBanniereTache(message: SDKMessage & { type: 'system' }): FragmentObserve[] {
    const sonde = message as unknown as {
      subtype?: string;
      tool_use_id?: string;
      task_id?: string;
      description?: string;
      subagent_type?: string;
      summary?: string;
      last_tool_name?: string;
      status?: string;
    };
    const ligneId = sonde.tool_use_id ?? sonde.task_id;
    if (ligneId === undefined) return [];
    if (sonde.subtype === 'task_started') {
      const ligne = this.#ligneOuCreation(ligneId, RACINE_FLUX);
      ligne.sousAgentType = sonde.subagent_type ?? ligne.sousAgentType;
      ligne.description = sonde.description ?? ligne.description;
      ligne.majA = this.#horloge.maintenant();
      return [];
    }
    if (sonde.subtype === 'task_progress') {
      const ligne = this.#ligneOuCreation(ligneId, RACINE_FLUX);
      ligne.dernierResume = sonde.summary ?? ligne.dernierResume;
      ligne.dernierOutil = sonde.last_tool_name ?? ligne.dernierOutil;
      ligne.vueAvecContenu = ligne.vueAvecContenu || sonde.summary !== undefined;
      ligne.majA = this.#horloge.maintenant();
      return sonde.summary !== undefined ? [{ ligneId, granularite: 'resume', texte: sonde.summary }] : [];
    }
    if (sonde.subtype === 'task_notification') {
      this.#terminerLigne(ligneId, sonde.status === 'failed' ? 'echouee' : 'terminee');
    }
    return [];
  }

  #dispatcherSousAgent(id: string, parentId: string): void {
    if (this.#lignes.has(id)) return;
    this.#lignes.set(id, this.#ligneVide(parentId, 1));
  }

  #terminerLigne(id: string, statut: StatutLigne): void {
    const ligne = this.#lignes.get(id);
    if (ligne === undefined) return;
    ligne.statut = statut;
    ligne.majA = this.#horloge.maintenant();
  }

  #ligneOuCreation(id: string, parentId: string | null): LigneInterne {
    const existante = this.#lignes.get(id);
    if (existante !== undefined) return existante;
    const creee = this.#ligneVide(parentId, parentId === null ? 0 : 1);
    this.#lignes.set(id, creee);
    return creee;
  }

  #ligneVide(parentId: string | null, profondeur: 0 | 1): LigneInterne {
    const maintenant = this.#horloge.maintenant();
    return {
      parentId,
      profondeur,
      sousAgentType: null,
      description: null,
      statut: 'active',
      dernierResume: null,
      dernierOutil: null,
      texteAccumule: '',
      dispatcheeA: maintenant,
      majA: maintenant,
      vueAvecContenu: false,
      partiel: null,
    };
  }

  #blocsDuMessage(message: SDKMessage & { type: 'assistant' | 'user' }): readonly BlocContenuSonde[] {
    // `message.message.content` est `BetaMessage`/`MessageParam` (alpha, profond) —
    // sonde large, jamais castée vers un type précis (même convention qu'`audit-permissions`).
    const enveloppe = message as unknown as { message?: { content?: unknown } };
    const contenu = enveloppe.message?.content;
    return Array.isArray(contenu) ? (contenu as BlocContenuSonde[]) : [];
  }

  #vue(id: string, l: LigneInterne): LigneTravailFlux {
    return {
      id,
      parentId: l.parentId,
      profondeur: l.profondeur,
      sousAgentType: l.sousAgentType,
      description: l.description,
      statut: l.statut,
      dernierResume: l.dernierResume,
      dernierOutil: l.dernierOutil,
      texteAccumule: l.texteAccumule,
      dispatcheeA: l.dispatcheeA,
      majA: l.majA,
    };
  }
}
