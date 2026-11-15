// Responsabilité : le journal d'Agent HQ — seul point de sortie console du dossier donnees, niveau et contexte passés.
export type NiveauJournal = 'debug' | 'info' | 'warn' | 'error';
export type ContexteJournal = Readonly<Record<string, unknown>>;

const SORTIES: Record<NiveauJournal, (...args: unknown[]) => void> = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

export function journaliser(niveau: NiveauJournal, message: string, contexte: ContexteJournal = {}): void {
  SORTIES[niveau](`[agent-hq] ${message}`, contexte);
}
