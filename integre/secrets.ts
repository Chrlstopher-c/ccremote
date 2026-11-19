// Responsabilité : les secrets du moteur intégré — mot de passe du relais (généré, jamais affiché) et secret du poste.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargerSecretsPostes, secretPoste } from '../relais/machines/secrets.ts';

const FICHIER_EMPREINTE = 'relais.empreinte';

/** Le secret du poste local : celui de la machine s'il existe déjà dans le dossier, sinon un nouveau (600). */
export function secretDuPoste(dossier: string, machine: string): string {
  return secretPoste(dossier, machine, chargerSecretsPostes(dossier));
}

/** Empreinte Bun.password du mot de passe du relais, créée au premier lancement. Le mot de passe n'est jamais gardé. */
export async function empreinteMotDePasse(dossier: string): Promise<string> {
  const chemin = join(dossier, FICHIER_EMPREINTE);
  if (existsSync(chemin)) return readFileSync(chemin, 'utf8').trim();
  const motDePasse = randomBytes(32).toString('base64url');
  const empreinte = await Bun.password.hash(motDePasse);
  const temporaire = `${chemin}.tmp`;
  writeFileSync(temporaire, `${empreinte}\n`, { mode: 0o600 });
  renameSync(temporaire, chemin);
  return empreinte;
}
