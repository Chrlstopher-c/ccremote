// Responsabilité : le logger unique (pino), lisible en terminal, JSON quand la sortie est un fichier.
import pino, { type Logger } from 'pino';

export function creerJournal(nom: string): Logger {
  const lisible = process.stdout.isTTY === true;
  return pino({
    name: nom,
    level: process.env['CCREMOTE_NIVEAU_LOG'] ?? 'info',
    ...(lisible ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } } : {}),
  });
}
