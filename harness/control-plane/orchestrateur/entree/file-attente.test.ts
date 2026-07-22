import { describe, expect, test } from 'bun:test'
import { FileAttente } from './file-attente.ts'
import { FileFermeeErreur } from './erreurs.ts'
import { estEnAttente } from './horloge-simulee.test-util.ts'

describe('FileAttente', () => {
  test('délivre dans l\'ordre de dépôt', async () => {
    const file = new FileAttente<number>({ capacite: 10 })
    await file.deposer(1)
    await file.deposer(2)
    await file.deposer(3)
    expect(await file.retirer()).toEqual({ fin: false, valeur: 1 })
    expect(await file.retirer()).toEqual({ fin: false, valeur: 2 })
    expect(await file.retirer()).toEqual({ fin: false, valeur: 3 })
  })

  test('un retrait sur file vide attend indéfiniment puis reçoit le dépôt', async () => {
    const file = new FileAttente<string>()
    const enAttente = file.retirer()
    expect(await estEnAttente(enAttente)).toBe(true)
    await file.deposer('tardif')
    expect(await enAttente).toEqual({ fin: false, valeur: 'tardif' })
  })

  test('contre-pression : aucun message perdu, ordre conservé au-delà de la capacité', async () => {
    const file = new FileAttente<number>({ capacite: 2 })
    const depots = [0, 1, 2, 3, 4].map((n) => file.deposer(n))
    expect(file.producteursBloques).toBe(3)

    const recus: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const resultat = await file.retirer()
      if (!resultat.fin) recus.push(resultat.valeur)
    }
    await Promise.all(depots)
    expect(recus).toEqual([0, 1, 2, 3, 4])
    expect(file.producteursBloques).toBe(0)
  })

  test('clore() draine les producteurs bloqués avant de terminer', async () => {
    const file = new FileAttente<number>({ capacite: 1 })
    const depots = [10, 11, 12].map((n) => file.deposer(n))
    file.clore()
    await Promise.all(depots)

    expect(await file.retirer()).toEqual({ fin: false, valeur: 10 })
    expect(await file.retirer()).toEqual({ fin: false, valeur: 11 })
    expect(await file.retirer()).toEqual({ fin: false, valeur: 12 })
    expect(await file.retirer()).toEqual({ fin: true })
  })

  test('clore() réveille un consommateur en attente avec la fin', async () => {
    const file = new FileAttente<number>()
    const enAttente = file.retirer()
    expect(await estEnAttente(enAttente)).toBe(true)
    file.clore()
    expect(await enAttente).toEqual({ fin: true })
  })

  test('déposer après clore() est rejeté, jamais avalé en silence', async () => {
    const file = new FileAttente<number>()
    file.clore()
    await expect(file.deposer(1)).rejects.toBeInstanceOf(FileFermeeErreur)
  })

  test('clore() est idempotent', async () => {
    const file = new FileAttente<number>()
    file.clore()
    file.clore()
    expect(file.estClose).toBe(true)
    expect(await file.retirer()).toEqual({ fin: true })
  })

  test('capacité 0 : chaque dépôt attend un consommateur, sans perte ni désordre', async () => {
    const file = new FileAttente<number>({ capacite: 0 })
    const depots = [7, 8].map((n) => file.deposer(n))
    expect(await estEnAttente(depots[0] as Promise<void>)).toBe(true)
    expect(await file.retirer()).toEqual({ fin: false, valeur: 7 })
    expect(await file.retirer()).toEqual({ fin: false, valeur: 8 })
    await Promise.all(depots)
  })

  test('rejette une capacité invalide', () => {
    expect(() => new FileAttente<number>({ capacite: -1 })).toThrow(RangeError)
    expect(() => new FileAttente<number>({ capacite: 1.5 })).toThrow(RangeError)
  })
})
