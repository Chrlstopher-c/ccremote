// Responsabilité : le logger unique (pino), lisible en terminal, JSON quand la sortie est un fichier.
// CCREMOTE_JOURNAL : fichier de journal (ajouté en fin, partagé par relais et poste) ; sans lui, la sortie standard.
import pino, { type DestinationStream, type Logger } from 'pino';

let fichier: DestinationStream | undefined;

function destination(): DestinationStream | undefined {
  const chemin = process.env['CCREMOTE_JOURNAL'];
  if (!chemin) return undefined;
  fichier ??= pino.destination({ dest: chemin, sync: true, mkdir: true });
  return fichier;
}

export function creerJournal(nom: string): Logger {
  const lisible = process.stdout.isTTY === true && !process.env['CCREMOTE_JOURNAL'];
  const options = {
    name: nom,
    level: process.env['CCREMOTE_NIVEAU_LOG'] ?? 'info',
    ...(lisible ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } } : {}),
  };
  const sortie = destination();
  return sortie ? pino(options, sortie) : pino(options);
}
