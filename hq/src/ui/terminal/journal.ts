// Responsabilité : journaliser les incidents du panneau terminal dans la console, avec un préfixe reconnaissable.
export function journaliserTerminal(message: string, contexte: Readonly<Record<string, unknown>> = {}): void {
  console.warn(`[agent-hq · terminal] ${message}`, contexte);
}
