// Responsabilité : journaliser les incidents du panneau fichiers et tirer un message lisible d'une erreur.
export function journaliserFichiers(message: string, contexte: Readonly<Record<string, unknown>> = {}): void {
  console.warn(`[agent-hq · fichiers] ${message}`, contexte);
}

export function messageErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
