// Responsabilité : signaler l'échec de lecture d'un transcript. Un transcript absent (ENOENT) n'est signalé en
// avertissement qu'une fois par chemin, puis seulement en debug : la session qui n'en a pas encore (ou plus) ne doit
// pas remplir le journal à chaque passage du balayage. Les autres erreurs restent des avertissements.
import type { Logger } from 'pino';

const dejaSignales = new Set<string>();

function estAbsent(erreur: unknown): boolean {
  return typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'ENOENT';
}

export function signalerTranscript(journal: Logger, chemin: string, erreur: unknown, message: string): void {
  if (!estAbsent(erreur)) {
    journal.warn({ err: erreur, chemin }, message);
    return;
  }
  if (dejaSignales.has(chemin)) {
    journal.debug({ chemin }, `${message} : transcript absent`);
    return;
  }
  dejaSignales.add(chemin);
  journal.warn({ err: erreur, chemin }, `${message} : transcript absent`);
}
