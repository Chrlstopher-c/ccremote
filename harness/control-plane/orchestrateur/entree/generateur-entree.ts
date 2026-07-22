/**
 * Responsabilité : exposer l'`AsyncIterable<SDKUserMessage>` d'entrée de la session
 * orchestrateur (A.1.3), maintenu ouvert tant que la session vit.
 *
 * Panne silencieuse couverte (grille de revue #1) : un flux d'entrée qui se termine
 * pendant que Claude travaille coupe `canUseTool` et les hooks, sans autre trace qu'un
 * `Error: Stream closed` sur stderr. Deux parades ici :
 *  1. le flux n'atteint jamais son terme naturel — seule `fermer()` le termine ;
 *  2. toute fermeture non sollicitée (`break` du consommateur, exception propagée) est
 *     journalisée en `error` et notifiée, ce qui rend la panne bruyante au lieu de muette.
 */
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { FileAttente } from './file-attente.ts'
import { FileFermeeErreur, FluxDejaConsommeErreur } from './erreurs.ts'
import { creerJournal, type Journal } from './journal.ts'
import { construireMessageUtilisateur, type OptionsMessage } from './message-utilisateur.ts'

export type EtatGenerateur = 'ouvert' | 'ferme' | 'ferme_implicitement'

export type CauseFermetureImprevue = 'return' | 'throw'

export interface ContexteFermetureImprevue {
  readonly cause: CauseFermetureImprevue
  readonly messagesEnAttente: number
}

export interface OptionsGenerateurEntree {
  readonly capacite?: number
  readonly journal?: Journal
  /** Session à estampiller sur les messages produits. */
  readonly sessionId?: string
  /** Appelé quand le consommateur termine le flux sans `fermer()` explicite. */
  readonly surFermetureImprevue?: (contexte: ContexteFermetureImprevue) => void
}

const NOM_JOURNAL = 'orchestrateur/entree'

export class GenerateurEntree {
  readonly #file: FileAttente<SDKUserMessage>
  readonly #journal: Journal
  readonly #sessionId: string | undefined
  readonly #surFermetureImprevue: ((contexte: ContexteFermetureImprevue) => void) | undefined
  #etat: EtatGenerateur = 'ouvert'
  #fluxReclame = false

  constructor(options: OptionsGenerateurEntree = {}) {
    this.#journal = options.journal ?? creerJournal(NOM_JOURNAL)
    this.#file = new FileAttente<SDKUserMessage>({
      capacite: options.capacite,
      journal: this.#journal,
    })
    this.#sessionId = options.sessionId
    this.#surFermetureImprevue = options.surFermetureImprevue
  }

  get etat(): EtatGenerateur {
    return this.#etat
  }

  get estOuvert(): boolean {
    return this.#etat === 'ouvert'
  }

  get messagesEnAttente(): number {
    return this.#file.taille + this.#file.producteursBloques
  }

  /** Met un texte en file. Attend si la file est pleine ; ne perd jamais le message. */
  envoyer(texte: string, options: OptionsMessage = {}): Promise<void> {
    const complet: OptionsMessage = { sessionId: this.#sessionId, ...options }
    try {
      return this.envoyerMessage(construireMessageUtilisateur(texte, complet))
    } catch (erreur) {
      this.#journal.error({ erreur }, 'construction du message utilisateur impossible')
      return Promise.reject(erreur instanceof Error ? erreur : new Error(String(erreur)))
    }
  }

  envoyerMessage(message: SDKUserMessage): Promise<void> {
    if (this.#etat !== 'ouvert') {
      return Promise.reject(
        new FileFermeeErreur(`envoi refusé : le générateur d'entrée est « ${this.#etat} »`),
      )
    }
    return this.#file.deposer(message)
  }

  /** Fermeture explicite de la session : seul mécanisme qui termine le flux. */
  fermer(): void {
    if (this.#etat !== 'ouvert') return
    this.#etat = 'ferme'
    this.#file.clore()
    this.#journal.info({ restants: this.#file.taille }, 'flux d\'entrée fermé explicitement')
  }

  /**
   * Le flux à passer à `query()`. Consommable une seule fois : deux consommateurs se
   * partageraient les messages, chacun n'en voyant qu'une partie, sans erreur visible.
   */
  get flux(): AsyncIterable<SDKUserMessage> {
    return { [Symbol.asyncIterator]: (): AsyncIterator<SDKUserMessage> => this.#reclamerIterateur() }
  }

  #reclamerIterateur(): AsyncIterator<SDKUserMessage> {
    if (this.#fluxReclame) {
      throw new FluxDejaConsommeErreur('le flux d\'entrée a déjà un consommateur')
    }
    this.#fluxReclame = true
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => this.#suivant(),
      return: async (): Promise<IteratorResult<SDKUserMessage>> => {
        this.#signalerRetourIterateur('return')
        return { done: true, value: undefined }
      },
      throw: async (raison?: unknown): Promise<IteratorResult<SDKUserMessage>> => {
        this.#signalerRetourIterateur('throw')
        throw raison instanceof Error ? raison : new Error(String(raison))
      },
    }
  }

  async #suivant(): Promise<IteratorResult<SDKUserMessage>> {
    const resultat = await this.#file.retirer()
    if (resultat.fin) {
      this.#journal.info({}, 'flux d\'entrée terminé après fermeture explicite')
      return { done: true, value: undefined }
    }
    return { done: false, value: resultat.valeur }
  }

  #signalerRetourIterateur(cause: CauseFermetureImprevue): void {
    if (this.#etat !== 'ouvert') {
      this.#journal.debug({ cause }, 'itérateur relâché après fermeture explicite')
      return
    }
    this.#etat = 'ferme_implicitement'
    const contexte: ContexteFermetureImprevue = { cause, messagesEnAttente: this.#file.taille }
    this.#journal.error(
      contexte,
      'fermeture NON SOLLICITÉE du flux d\'entrée : canUseTool et les hooks vont cesser d\'être appelés',
    )
    try {
      this.#surFermetureImprevue?.(contexte)
    } catch (erreur) {
      this.#journal.error({ erreur }, 'le rappel de fermeture imprévue a levé')
    }
  }
}
