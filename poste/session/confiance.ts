// Responsabilité : approuver un dossier dans la config Claude avant d'y lancer une session à distance.
// Sans ça, le CLI affiche « Do you trust this folder? » — option présélectionnée : quitter. Personne n'est là pour répondre.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function fichierConfigClaude(configDir: string | null): string {
  return configDir ? join(configDir, '.claude.json') : join(homedir(), '.claude.json');
}

// Écriture seulement si nécessaire, et atomique : les Claude en cours réécrivent ce fichier régulièrement.
export function approuverDossier(dossier: string, configDir: string | null): void {
  const fichier = fichierConfigClaude(configDir);
  const config = existsSync(fichier) ? (JSON.parse(readFileSync(fichier, 'utf8')) as Record<string, unknown>) : {};
  const projets = (config['projects'] ?? {}) as Record<string, Record<string, unknown>>;
  if (projets[dossier]?.['hasTrustDialogAccepted'] === true) return;
  projets[dossier] = { ...(projets[dossier] ?? {}), hasTrustDialogAccepted: true };
  const temporaire = `${fichier}.ccremote.tmp`;
  writeFileSync(temporaire, JSON.stringify({ ...config, projects: projets }, null, 2));
  renameSync(temporaire, fichier);
}
