// Responsabilité : les secrets des postes installés par SSH — un fichier 600 par machine, hors dépôt, relu au démarrage.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function dossierSecretsPostes(): string {
  return process.env['QUART_CONFIG_RELAIS'] ?? join(homedir(), '.config/quart-lanterne/postes');
}

const SUFFIXE = '.secret';

/** Tous les secrets connus : id de machine → secret. Un fichier illisible est ignoré (jamais un secret vide). */
export function chargerSecretsPostes(dossier: string): Map<string, string> {
  const secrets = new Map<string, string>();
  if (!existsSync(dossier)) return secrets;
  for (const nom of readdirSync(dossier)) {
    if (!nom.endsWith(SUFFIXE)) continue;
    const valeur = readFileSync(join(dossier, nom), 'utf8').trim();
    if (valeur) secrets.set(nom.slice(0, -SUFFIXE.length), valeur);
  }
  return secrets;
}

/** Crée le secret d'une machine s'il n'existe pas (réinstallation : on garde le même). Écriture atomique, mode 600. */
export function secretPoste(dossier: string, id: string, secrets: Map<string, string>): string {
  const existant = secrets.get(id);
  if (existant) return existant;
  const secret = randomBytes(32).toString('hex');
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const chemin = join(dossier, `${id}${SUFFIXE}`);
  const temporaire = `${chemin}.tmp`;
  writeFileSync(temporaire, `${secret}\n`, { mode: 0o600 });
  chmodSync(temporaire, 0o600);
  renameSync(temporaire, chemin);
  secrets.set(id, secret);
  return secret;
}

export function retirerSecretPoste(dossier: string, id: string, secrets: Map<string, string>): void {
  secrets.delete(id);
  rmSync(join(dossier, `${id}${SUFFIXE}`), { force: true });
}
