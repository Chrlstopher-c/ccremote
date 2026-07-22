import { describe, expect, test } from 'bun:test'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { GenerateurEntree, type ContexteFermetureImprevue } from './generateur-entree.ts'
import { FileFermeeErreur, FluxDejaConsommeErreur } from './erreurs.ts'
import { journalSilencieux, type Journal } from './journal.ts'
import { estEnAttente, HorlogeSimulee } from './horloge-simulee.test-util.ts'

const DIX_MINUTES_MS = 10 * 60 * 1000

function creer(options: Partial<ConstructorParameters<typeof GenerateurEntree>[0]> = {}): GenerateurEntree {
  return new GenerateurEntree({ journal: journalSilencieux, sessionId: 'sess-test', ...options })
}

function texteDe(message: SDKUserMessage): string {
  const contenu = message.message.content
  return typeof contenu === 'string' ? contenu : JSON.stringify(contenu)
}

describe('GenerateurEntree — le flux ne se termine jamais seul', () => {
  test('dix minutes d\'inactivité simulée ne terminent pas le flux et ne posent aucun minuteur', async () => {
    const horloge = new HorlogeSimulee()
    const generateur = creer()
    const iterateur = generateur.flux[Symbol.asyncIterator]()

    horloge.installer()
    let enAttente: boolean
    let minuteries: number
    try {
      const prochain = iterateur.next()
      minuteries = horloge.minuteriesActives
      horloge.avancer(DIX_MINUTES_MS)
      enAttente = await estEnAttente(prochain)
      horloge.restaurer()

      // Après le silence, une action est encore délivrable : le flux est resté ouvert.
      await generateur.envoyer('permission demandée après le silence')
      const resultat = await prochain
      expect(resultat.done).toBe(false)
      expect(texteDe(resultat.value as SDKUserMessage)).toBe('permission demandée après le silence')
    } finally {
      horloge.restaurer()
    }

    expect(minuteries).toBe(0)
    expect(enAttente).toBe(true)
    expect(generateur.etat).toBe('ouvert')
  })

  test('le flux reste ouvert après consommation de tous les messages', async () => {
    const generateur = creer()
    const iterateur = generateur.flux[Symbol.asyncIterator]()
    await generateur.envoyer('premier')
    expect((await iterateur.next()).done).toBe(false)

    const prochain = iterateur.next()
    expect(await estEnAttente(prochain)).toBe(true)
    generateur.fermer()
    expect((await prochain).done).toBe(true)
  })
})

describe('GenerateurEntree — ordre et intégrité', () => {
  test('délivre les messages dans l\'ordre d\'envoi', async () => {
    const generateur = creer()
    const iterateur = generateur.flux[Symbol.asyncIterator]()
    for (const texte of ['a', 'b', 'c']) await generateur.envoyer(texte)

    const recus: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const resultat = await iterateur.next()
      if (resultat.done !== true) recus.push(texteDe(resultat.value))
    }
    expect(recus).toEqual(['a', 'b', 'c'])
  })

  test('produit un SDKUserMessage bien formé', async () => {
    const generateur = creer()
    const iterateur = generateur.flux[Symbol.asyncIterator]()
    await generateur.envoyer('bonjour')
    const resultat = await iterateur.next()
    const message = resultat.value as SDKUserMessage

    expect(message.type).toBe('user')
    expect(message.message.role).toBe('user')
    expect(message.parent_tool_use_id).toBeNull()
    expect(message.session_id).toBe('sess-test')
    expect(typeof message.timestamp).toBe('string')
  })

  test('contre-pression : aucun message perdu quand la file est pleine', async () => {
    const generateur = creer({ capacite: 2 })
    const envois = ['m0', 'm1', 'm2', 'm3', 'm4'].map((t) => generateur.envoyer(t))
    expect(generateur.messagesEnAttente).toBe(5)

    const iterateur = generateur.flux[Symbol.asyncIterator]()
    const recus: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const resultat = await iterateur.next()
      if (resultat.done !== true) recus.push(texteDe(resultat.value))
    }
    await Promise.all(envois)
    expect(recus).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
    expect(generateur.messagesEnAttente).toBe(0)
  })

  test('refuse un second consommateur du flux', () => {
    const generateur = creer()
    generateur.flux[Symbol.asyncIterator]()
    expect(() => generateur.flux[Symbol.asyncIterator]()).toThrow(FluxDejaConsommeErreur)
  })

  test('refuse un texte vide sans corrompre l\'état', async () => {
    const generateur = creer()
    await expect(generateur.envoyer('')).rejects.toBeInstanceOf(RangeError)
    expect(generateur.etat).toBe('ouvert')
  })
})

describe('GenerateurEntree — fermeture', () => {
  test('fermer() draine les messages en file avant de terminer', async () => {
    const generateur = creer()
    await generateur.envoyer('reste-1')
    await generateur.envoyer('reste-2')
    generateur.fermer()

    const recus: string[] = []
    for await (const message of generateur.flux) recus.push(texteDe(message))
    expect(recus).toEqual(['reste-1', 'reste-2'])
    expect(generateur.etat).toBe('ferme')
  })

  test('envoyer après fermer() est rejeté', async () => {
    const generateur = creer()
    generateur.fermer()
    await expect(generateur.envoyer('trop tard')).rejects.toBeInstanceOf(FileFermeeErreur)
  })

  test('fermer() est idempotent', async () => {
    const generateur = creer()
    generateur.fermer()
    generateur.fermer()
    expect(generateur.etat).toBe('ferme')
  })

  test('une fermeture non sollicitée (break) est signalée, pas silencieuse', async () => {
    const alertes: ContexteFermetureImprevue[] = []
    const erreurs: object[] = []
    const journal: Journal = {
      ...journalSilencieux,
      error: (objet: object): void => {
        erreurs.push(objet)
      },
    }
    const generateur = creer({ journal, surFermetureImprevue: (c) => alertes.push(c) })
    await generateur.envoyer('un')
    await generateur.envoyer('deux')

    for await (const _message of generateur.flux) break

    expect(generateur.etat).toBe('ferme_implicitement')
    expect(alertes).toHaveLength(1)
    expect(alertes[0]?.cause).toBe('return')
    expect(alertes[0]?.messagesEnAttente).toBe(1)
    expect(erreurs).toHaveLength(1)
  })

  test('une exception du consommateur est signalée comme fermeture non sollicitée', async () => {
    const alertes: ContexteFermetureImprevue[] = []
    const generateur = creer({ surFermetureImprevue: (c) => alertes.push(c), journal: journalSilencieux })
    const iterateur = generateur.flux[Symbol.asyncIterator]()
    await generateur.envoyer('un')

    await expect(iterateur.throw?.(new Error('boum'))).rejects.toThrow('boum')
    expect(generateur.etat).toBe('ferme_implicitement')
    expect(alertes[0]?.cause).toBe('throw')
  })

  test('relâcher l\'itérateur après fermer() n\'est pas signalé comme imprévu', async () => {
    const alertes: ContexteFermetureImprevue[] = []
    const generateur = creer({ surFermetureImprevue: (c) => alertes.push(c), journal: journalSilencieux })
    await generateur.envoyer('un')
    generateur.fermer()

    for await (const _message of generateur.flux) break

    expect(generateur.etat).toBe('ferme')
    expect(alertes).toHaveLength(0)
  })

  test('un rappel de fermeture imprévue qui lève ne casse pas le générateur', async () => {
    const generateur = creer({
      surFermetureImprevue: (): void => {
        throw new Error('rappel défaillant')
      },
      journal: journalSilencieux,
    })
    await generateur.envoyer('un')
    for await (const _message of generateur.flux) break
    expect(generateur.etat).toBe('ferme_implicitement')
  })
})
