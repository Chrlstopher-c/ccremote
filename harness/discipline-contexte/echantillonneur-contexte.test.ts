// Tests de l'échantillonneur de contexte (A.1.4 point 2, mission M-42).
// Critères couverts :
//  (a) getContextUsage() échantillonné avec des seuils, mesure jamais estimation
//  ⚠ getContextUsage peut être absente : comportement sûr, jamais une exception qui remonte
//  ⚠ après `result`, le transport échoue avec un message précis : traité comme fin normale

import { describe, expect, test } from 'bun:test'
import { HorlogeSimulee } from '../test-harness/deterministe/horloge-simulee.ts'
import {
  EchantillonneurContexte,
  MOTIF_TRANSPORT_FERME,
  type OptionsEchantillonneur,
} from './echantillonneur-contexte.ts'
import type { MesureBrute, MesureContexte, NiveauContexte, SourceContexte } from './contrats.ts'

class SourceFactice implements SourceContexte {
  #reponses: Array<() => Promise<MesureBrute>> = []
  #appels = 0

  get appels(): number {
    return this.#appels
  }

  programmerReponse(reponse: MesureBrute): void {
    this.#reponses.push(() => Promise.resolve(reponse))
  }

  programmerErreur(message: string): void {
    this.#reponses.push(() => Promise.reject(new Error(message)))
  }

  getContextUsage(): Promise<MesureBrute> {
    this.#appels += 1
    const suivante = this.#reponses.shift()
    if (suivante === undefined) return Promise.reject(new Error('aucune réponse programmée'))
    return suivante()
  }
}

function mesure(totalTokens: number, maxTokens = 200_000): MesureBrute {
  return { totalTokens, maxTokens, model: 'opus' }
}

describe('EchantillonneurContexte — (a) mesure, pas estimation', () => {
  test('échantillonne périodiquement via la source injectée, jamais Date.now/setTimeout réel', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerReponse(mesure(1_000))
    source.programmerReponse(mesure(2_000))
    const mesures: MesureContexte[] = []
    const echantillonneur = new EchantillonneurContexte(source, {
      horloge,
      intervalleMs: 1_000,
      surEchantillon: (m) => mesures.push(m),
    })
    echantillonneur.demarrer()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(source.appels).toBe(2)
    expect(mesures.map((m) => m.totalTokens)).toEqual([1_000, 2_000])
  })

  test('calcule le ratio lui-même (totalTokens/maxTokens), pas via `percentage`', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerReponse(mesure(50_000, 200_000))
    const mesures: MesureContexte[] = []
    const echantillonneur = new EchantillonneurContexte(source, {
      horloge,
      intervalleMs: 1_000,
      surEchantillon: (m) => mesures.push(m),
    })
    echantillonneur.demarrer()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(mesures).toHaveLength(1)
    expect(mesures[0]?.ratio).toBeCloseTo(0.25, 5)
  })

  test('maxTokens à 0 ne fait pas planter le calcul (ratio 0)', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerReponse(mesure(0, 0))
    const mesures: MesureContexte[] = []
    const echantillonneur = new EchantillonneurContexte(source, {
      horloge,
      intervalleMs: 1_000,
      surEchantillon: (m) => mesures.push(m),
    })
    echantillonneur.demarrer()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(mesures[0]?.ratio).toBe(0)
    expect(mesures[0]?.niveau).toBe('sain')
  })
})

describe('EchantillonneurContexte — seuils d\'alerte', () => {
  async function faireDefiler(
    horloge: HorlogeSimulee,
    intervalleMs: number,
    n: number,
  ): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      horloge.avancer(intervalleMs)
      await Promise.resolve()
      await Promise.resolve()
    }
  }

  test('surChangementNiveau ne se déclenche qu\'au franchissement, pas à chaque échantillon', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerReponse(mesure(10_000, 200_000)) // sain
    source.programmerReponse(mesure(11_000, 200_000)) // toujours sain
    source.programmerReponse(mesure(130_000, 200_000)) // attention (65%)
    source.programmerReponse(mesure(131_000, 200_000)) // toujours attention
    source.programmerReponse(mesure(180_000, 200_000)) // alerte (90%)
    const changements: NiveauContexte[] = []
    const echantillonneur = new EchantillonneurContexte(source, {
      horloge,
      intervalleMs: 1_000,
      surChangementNiveau: (m) => changements.push(m.niveau),
    })
    echantillonneur.demarrer()
    await faireDefiler(horloge, 1_000, 5)
    expect(changements).toEqual(['sain', 'attention', 'alerte'])
  })
})

describe('EchantillonneurContexte — comportement sûr si getContextUsage est absente', () => {
  test('s\'arrête proprement, sans lever, si la méthode n\'existe pas sur la source', async () => {
    const horloge = new HorlogeSimulee()
    // Source structurellement incomplète : simule un binaire/mode où la méthode manque réellement,
    // malgré ce que le type SDK déclare (⚠ HYP capabilities vide, ne jamais supposer).
    const sourceIncomplete = {} as SourceContexte
    const arrets: Array<[string, string]> = []
    const echantillonneur = new EchantillonneurContexte(sourceIncomplete, {
      horloge,
      intervalleMs: 1_000,
      surArret: (etat, motif) => arrets.push([etat, motif]),
    })
    echantillonneur.demarrer()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(echantillonneur.etat).toBe('arrete_indisponible')
    expect(arrets).toHaveLength(1)
    expect(horloge.minuteriesEnAttente()).toBe(0)
  })
})

describe('EchantillonneurContexte — fin de session vs panne réelle', () => {
  test('erreur "ProcessTransport is not ready for writing" ⇒ arrêt classé fin de session, pas panne', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerErreur(MOTIF_TRANSPORT_FERME)
    const arrets: string[] = []
    const echantillonneur = new EchantillonneurContexte(source, {
      horloge,
      intervalleMs: 1_000,
      surArret: (etat) => arrets.push(etat),
    })
    echantillonneur.demarrer()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(echantillonneur.etat).toBe('arrete_session_terminee')
    expect(arrets).toEqual(['arrete_session_terminee'])
    expect(horloge.minuteriesEnAttente()).toBe(0)
  })

  test('une erreur transitoire quelconque continue l\'échantillonnage (pas d\'arrêt prématuré)', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerErreur('ECONNRESET')
    source.programmerReponse(mesure(5_000))
    const mesures: MesureContexte[] = []
    const echantillonneur = new EchantillonneurContexte(source, {
      horloge,
      intervalleMs: 1_000,
      surEchantillon: (m) => mesures.push(m),
    })
    echantillonneur.demarrer()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    horloge.avancer(1_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(echantillonneur.etat).toBe('actif')
    expect(mesures).toHaveLength(1)
  })

  test('3 échecs consécutifs non identifiés comme fin de session ⇒ abandon (filet de sûreté)', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerErreur('panne 1')
    source.programmerErreur('panne 2')
    source.programmerErreur('panne 3')
    const arrets: string[] = []
    const echantillonneur = new EchantillonneurContexte(source, {
      horloge,
      intervalleMs: 1_000,
      surArret: (etat) => arrets.push(etat),
    })
    echantillonneur.demarrer()
    for (let i = 0; i < 3; i += 1) {
      horloge.avancer(1_000)
      await Promise.resolve()
      await Promise.resolve()
    }
    expect(echantillonneur.etat).toBe('arrete_echecs')
    expect(arrets).toEqual(['arrete_echecs'])
    expect(horloge.minuteriesEnAttente()).toBe(0)
  })
})

describe('EchantillonneurContexte — arrêt volontaire (M-41 appellera ceci au result)', () => {
  test('arreter() empêche tout appel ultérieur, idempotent', async () => {
    const horloge = new HorlogeSimulee()
    const source = new SourceFactice()
    source.programmerReponse(mesure(1_000))
    const echantillonneur = new EchantillonneurContexte(source, { horloge, intervalleMs: 1_000 })
    echantillonneur.demarrer()
    echantillonneur.arreter()
    echantillonneur.arreter()
    horloge.avancer(5_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(source.appels).toBe(0)
    expect(horloge.minuteriesEnAttente()).toBe(0)
  })
})

describe('EchantillonneurContexte — validation', () => {
  test('rejette un intervalle <= 0', () => {
    const source = new SourceFactice()
    const construire = (): EchantillonneurContexte =>
      new EchantillonneurContexte(source, { intervalleMs: 0 } satisfies OptionsEchantillonneur)
    expect(construire).toThrow(RangeError)
  })
})
