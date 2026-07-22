/**
 * Responsabilité : point d'entrée unique du flux `AsyncIterable<SDKUserMessage>`
 * de LA session orchestrateur (A.1.3), assemblé à partir de `GenerateurEntree`
 * (M-02, livré — non modifié ici, seulement composé).
 *
 * Préserve H-66 à CE niveau (celui du Pi, pas encore celui d'une équipe — H-66
 * lui-même est non-prioritaire à l'implémentation complète, mais REPRISE.md et
 * 16-decisions-operateur.md exigent explicitement de ne rien construire qui la
 * rende impossible plus tard). Deux origines possibles pour un message entrant
 * dans l'orchestrateur :
 *  - `operateur` : Chris, depuis l'app — le chemin normal, quasi tous les messages ;
 *  - `systeme` : un événement du harness lui-même (ex. reprise après incident,
 *    résultat de réconciliation) — PAS une parole de Chris.
 *
 * `entree/message-utilisateur.ts` (M-02, livré) ne porte aucun champ émetteur —
 * ce n'est pas à cette mission de faire évoluer son schéma (scope_guard). La
 * garantie est donc portée ICI, au niveau du TEXTE lui-même, par un préfixe
 * STRUCTUREL et non ambigu que le modèle voit dans tous les cas — jamais une
 * convention de rédaction qu'un futur appel pourrait oublier de suivre : les
 * deux seules portes d'entrée de ce module (`envoyerOperateur`/`envoyerSysteme`)
 * l'appliquent automatiquement, aucun appelant ne peut construire un message
 * SANS étiquette.
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  GenerateurEntree,
  type ContexteFermetureImprevue,
  type EtatGenerateur,
  type Journal,
} from '../entree/index.ts';

export type EmetteurEntreeOrchestrateur = 'operateur' | 'systeme';

/** Préfixe structurel — stable, grep-able, jamais déduit d'un ton ou d'un contenu (H-66). */
export function formaterMessageAttribue(emetteur: EmetteurEntreeOrchestrateur, texte: string): string {
  return `[emetteur:${emetteur}] ${texte}`;
}

export interface OptionsEntreeOrchestrateur {
  readonly sessionId?: string;
  readonly capacite?: number;
  readonly journal?: Journal;
  readonly surFermetureImprevue?: (contexte: ContexteFermetureImprevue) => void;
}

/**
 * Enveloppe `GenerateurEntree` : ajoute l'attribution structurelle en entrée,
 * ne change rien à ses garanties de flux (A.1.3, panne #1). Aucune méthode
 * `envoyer`/`envoyerMessage` brute n'est exposée par ce module : les deux seules
 * portes sont étiquetées par construction.
 */
export class EntreeOrchestrateur {
  readonly #generateur: GenerateurEntree;

  constructor(options: OptionsEntreeOrchestrateur = {}) {
    this.#generateur = new GenerateurEntree(options);
  }

  get etat(): EtatGenerateur {
    return this.#generateur.etat;
  }

  get estOuvert(): boolean {
    return this.#generateur.estOuvert;
  }

  get flux(): AsyncIterable<SDKUserMessage> {
    return this.#generateur.flux;
  }

  /** Message de Chris depuis l'app — le chemin normal. */
  envoyerOperateur(texte: string): Promise<void> {
    return this.#generateur.envoyer(formaterMessageAttribue('operateur', texte));
  }

  /** Événement du harness lui-même (reprise, résultat de réconciliation…) — jamais une parole de Chris. */
  envoyerSysteme(texte: string): Promise<void> {
    return this.#generateur.envoyer(formaterMessageAttribue('systeme', texte));
  }

  fermer(): void {
    this.#generateur.fermer();
  }
}
