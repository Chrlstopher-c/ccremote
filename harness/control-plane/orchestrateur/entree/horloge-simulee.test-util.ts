/**
 * Responsabilité : temps simulé pour les tests du slice « entrée ».
 * Remplace `setTimeout` / `setInterval` globaux afin de prouver deux choses :
 *  - le générateur ne programme AUCUN minuteur (donc aucun délai d'inactivité caché) ;
 *  - dix minutes simulées ne terminent pas le flux.
 * Réservé aux tests — jamais importé par le code de production.
 */

interface Minuterie {
  readonly id: number
  readonly echeance: number
  readonly rappel: () => void
}

type PoseMinuterie = (rappel: (...args: unknown[]) => void, delai?: number) => unknown
type RetireMinuterie = (identifiant?: unknown) => void

export class HorlogeSimulee {
  #minuteries: Minuterie[] = []
  #maintenant = 0
  #prochainId = 1
  #installee = false
  #setTimeoutOrigine: PoseMinuterie | undefined
  #setIntervalOrigine: PoseMinuterie | undefined
  #clearTimeoutOrigine: RetireMinuterie | undefined
  #clearIntervalOrigine: RetireMinuterie | undefined

  /** Nombre de minuteries encore programmées : doit rester à 0 pour le générateur d'entrée. */
  get minuteriesActives(): number {
    return this.#minuteries.length
  }

  get maintenant(): number {
    return this.#maintenant
  }

  installer(): void {
    if (this.#installee) return
    this.#installee = true
    // Justification du cast : on remplace des globaux dont la signature Bun/Node est plus
    // riche que ce que le test a besoin d'émuler. Portée limitée au test, restaurée ensuite.
    const global = globalThis as unknown as Record<string, unknown>
    this.#setTimeoutOrigine = global['setTimeout'] as PoseMinuterie
    this.#setIntervalOrigine = global['setInterval'] as PoseMinuterie
    this.#clearTimeoutOrigine = global['clearTimeout'] as RetireMinuterie
    this.#clearIntervalOrigine = global['clearInterval'] as RetireMinuterie
    global['setTimeout'] = (rappel: () => void, delai = 0): number => this.#poser(rappel, delai)
    global['setInterval'] = (rappel: () => void, delai = 0): number => this.#poser(rappel, delai)
    global['clearTimeout'] = (id: number): void => this.#retirer(id)
    global['clearInterval'] = (id: number): void => this.#retirer(id)
  }

  restaurer(): void {
    if (!this.#installee) return
    this.#installee = false
    const global = globalThis as unknown as Record<string, unknown>
    global['setTimeout'] = this.#setTimeoutOrigine
    global['setInterval'] = this.#setIntervalOrigine
    global['clearTimeout'] = this.#clearTimeoutOrigine
    global['clearInterval'] = this.#clearIntervalOrigine
    this.#minuteries = []
  }

  /** Avance le temps simulé et déclenche toutes les minuteries échues. */
  avancer(millisecondes: number): void {
    this.#maintenant += millisecondes
    let echues = this.#minuteries.filter((m) => m.echeance <= this.#maintenant)
    while (echues.length > 0) {
      this.#minuteries = this.#minuteries.filter((m) => m.echeance > this.#maintenant)
      for (const minuterie of echues) minuterie.rappel()
      echues = this.#minuteries.filter((m) => m.echeance <= this.#maintenant)
    }
  }

  #poser(rappel: () => void, delai: number): number {
    const id = this.#prochainId++
    this.#minuteries.push({ id, echeance: this.#maintenant + delai, rappel })
    return id
  }

  #retirer(id: number): void {
    this.#minuteries = this.#minuteries.filter((m) => m.id !== id)
  }
}

const EN_ATTENTE = Symbol('en_attente')

/**
 * Vérifie qu'une promesse n'est pas résolue, sans consommer de temps réel :
 * la course se joue uniquement en microtâches.
 */
export async function estEnAttente(promesse: Promise<unknown>): Promise<boolean> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
  const resultat = await Promise.race([promesse, Promise.resolve(EN_ATTENTE)])
  return resultat === EN_ATTENTE
}
