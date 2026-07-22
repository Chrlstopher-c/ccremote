/**
 * Responsabilité : construire un `SDKUserMessage` valide à partir d'un texte.
 * Seul point du slice qui connaît la forme de données du SDK.
 */
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export interface OptionsMessage {
  readonly sessionId?: string
  /** `null` = message de premier niveau. Renseigné uniquement pour un retour d'outil. */
  readonly parentToolUseId?: string | null
  /** Horodatage ISO 8601. Par défaut, l'instant de construction. */
  readonly horodatage?: string
}

export function construireMessageUtilisateur(
  texte: string,
  options: OptionsMessage = {},
): SDKUserMessage {
  if (texte.length === 0) {
    throw new RangeError('un message utilisateur vide n\'est jamais envoyé au SDK')
  }
  return {
    type: 'user',
    message: { role: 'user', content: texte },
    parent_tool_use_id: options.parentToolUseId ?? null,
    session_id: options.sessionId,
    timestamp: options.horodatage ?? new Date().toISOString(),
  }
}
