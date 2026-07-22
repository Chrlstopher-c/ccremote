/**
 * Vérifie à la compilation que `GenerateurEntree.flux` est bien le type attendu par
 * `query({ prompt })`. Une dérive de forme ici casserait la session sans erreur d'exécution
 * évidente — le SDK se contenterait d'un flux qu'il ne lit jamais correctement.
 */
import { describe, expect, test } from 'bun:test'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { GenerateurEntree } from './generateur-entree.ts'
import { journalSilencieux } from './journal.ts'

type PromptQuery = string | AsyncIterable<SDKUserMessage>

describe('contrat SDK', () => {
  test('le flux est assignable au paramètre prompt de query()', async () => {
    const generateur = new GenerateurEntree({ journal: journalSilencieux })
    const prompt: PromptQuery = generateur.flux
    await generateur.envoyer('vérification de contrat')
    generateur.fermer()

    const recus: SDKUserMessage[] = []
    if (typeof prompt !== 'string') {
      for await (const message of prompt) recus.push(message)
    }
    expect(recus).toHaveLength(1)
    expect(recus[0]?.type).toBe('user')
  })
})
