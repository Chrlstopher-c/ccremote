/**
 * Responsabilité : fournir le journal du slice « entrée » et son double silencieux pour les tests.
 * Aucune dépendance au SDK.
 */
import pino from 'pino'

export interface Journal {
  debug(objet: object, message?: string): void
  info(objet: object, message?: string): void
  warn(objet: object, message?: string): void
  error(objet: object, message?: string): void
}

const NIVEAU_PAR_DEFAUT = 'info'

/**
 * Instancie un journal pino. Toute erreur d'initialisation (transport, permissions)
 * retombe sur le journal silencieux plutôt que d'empêcher l'ouverture de la session.
 */
export function creerJournal(nom: string): Journal {
  try {
    return pino({ name: nom, level: process.env['LOG_LEVEL'] ?? NIVEAU_PAR_DEFAUT })
  } catch (erreur) {
    // Dernier recours : on ne laisse pas l'absence de journal casser le générateur d'entrée.
    console.error('[entree] initialisation du journal impossible', erreur)
    return journalSilencieux
  }
}

export const journalSilencieux: Journal = {
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
}
