/**
 * Responsabilité : file d'attente asynchrone bornée, ordonnée, sans perte de message.
 * Unité isolée — aucune dépendance au SDK, aucun minuteur.
 *
 * Invariants (A.1.3) :
 *  - `retirer()` sur file vide ne rend jamais la main tant que rien n'est déposé
 *    ET que la file n'est pas close : c'est le « signal d'attente ». Aucun délai d'inactivité.
 *  - l'ordre de dépôt est l'ordre de retrait, y compris quand des producteurs sont bloqués ;
 *  - `clore()` ne perd rien : les producteurs bloqués sont d'abord drainés dans le tampon.
 */
import { FileFermeeErreur } from './erreurs.ts'
import type { Journal } from './journal.ts'

export type ResultatRetrait<T> = { readonly fin: false; readonly valeur: T } | { readonly fin: true }

interface ProducteurEnAttente<T> {
  readonly valeur: T
  readonly resoudre: () => void
}

export interface OptionsFileAttente {
  /** Nombre de messages tamponnés avant que `deposer()` fasse attendre le producteur. */
  readonly capacite?: number
  readonly journal?: Journal
}

const CAPACITE_PAR_DEFAUT = 64

export class FileAttente<T> {
  readonly #tampon: T[] = []
  readonly #producteurs: ProducteurEnAttente<T>[] = []
  readonly #consommateurs: Array<(resultat: ResultatRetrait<T>) => void> = []
  readonly #capacite: number
  readonly #journal: Journal | undefined
  #close = false

  constructor(options: OptionsFileAttente = {}) {
    const capacite = options.capacite ?? CAPACITE_PAR_DEFAUT
    if (!Number.isInteger(capacite) || capacite < 0) {
      throw new RangeError('capacite doit être un entier >= 0')
    }
    this.#capacite = capacite
    this.#journal = options.journal
  }

  get taille(): number {
    return this.#tampon.length
  }

  get producteursBloques(): number {
    return this.#producteurs.length
  }

  get estClose(): boolean {
    return this.#close
  }

  /**
   * Dépose une valeur. La promesse ne se résout que lorsque la valeur est acceptée
   * (tamponnée ou remise directement à un consommateur en attente) : c'est la contre-pression.
   * Aucune valeur n'est jamais rejetée silencieusement ni écrasée.
   */
  deposer(valeur: T): Promise<void> {
    if (this.#close) {
      return Promise.reject(new FileFermeeErreur('dépôt refusé : la file est close'))
    }
    const consommateur = this.#consommateurs.shift()
    if (consommateur !== undefined) {
      consommateur({ fin: false, valeur })
      return Promise.resolve()
    }
    if (this.#tampon.length < this.#capacite) {
      this.#tampon.push(valeur)
      return Promise.resolve()
    }
    return new Promise<void>((resoudre) => {
      this.#producteurs.push({ valeur, resoudre })
    })
  }

  /**
   * Retire la prochaine valeur. Sur file vide et ouverte, la promesse reste **indéfiniment**
   * en attente — c'est ce qui empêche le flux d'entrée d'atteindre son terme naturel.
   */
  retirer(): Promise<ResultatRetrait<T>> {
    const suivant = this.#defiler()
    if (suivant !== undefined) {
      return Promise.resolve({ fin: false, valeur: suivant.valeur })
    }
    if (this.#close) {
      return Promise.resolve({ fin: true })
    }
    return new Promise<ResultatRetrait<T>>((resoudre) => {
      this.#consommateurs.push(resoudre)
    })
  }

  /**
   * Fermeture explicite : seul mécanisme qui termine la file. Les valeurs déjà déposées
   * — y compris celles des producteurs bloqués — restent délivrables avant le terme.
   */
  clore(): void {
    if (this.#close) return
    this.#close = true
    this.#drainerProducteurs()
    this.#journal?.debug({ restants: this.#tampon.length }, 'file close, drainage avant terme')
    if (this.#tampon.length > 0) return
    this.#terminerConsommateurs()
  }

  #defiler(): { valeur: T } | undefined {
    if (this.#tampon.length > 0) {
      const valeur = this.#tampon.shift()
      this.#promouvoirProducteur()
      return valeur === undefined ? undefined : { valeur }
    }
    const producteur = this.#producteurs.shift()
    if (producteur === undefined) return undefined
    producteur.resoudre()
    return { valeur: producteur.valeur }
  }

  #promouvoirProducteur(): void {
    const producteur = this.#producteurs.shift()
    if (producteur === undefined) return
    this.#tampon.push(producteur.valeur)
    producteur.resoudre()
  }

  #drainerProducteurs(): void {
    while (this.#producteurs.length > 0) {
      const producteur = this.#producteurs.shift()
      if (producteur === undefined) break
      this.#tampon.push(producteur.valeur)
      producteur.resoudre()
    }
  }

  #terminerConsommateurs(): void {
    while (this.#consommateurs.length > 0) {
      const consommateur = this.#consommateurs.shift()
      consommateur?.({ fin: true })
    }
  }
}
