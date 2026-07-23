/**
 * Responsabilité : lire, côté PC, le jeton d'accès OAuth de chaque compte pour
 * que le Pi puisse sonder les quotas LUI-MÊME, en HTTP, sans le PC.
 *
 * `☠` C'est ce qui rend les jauges vivantes PC éteint. La sonde vivait sur le PC
 * parce que les `CLAUDE_CONFIG_DIR` y sont — mais l'endpoint OAuth ne demande
 * qu'un jeton, pas un CLI. Le PC n'est donc plus la sonde : il n'est plus que la
 * SOURCE du jeton, et le Pi mesure en continu.
 *
 * `☠` Aucun REFRESH ici ni côté Pi. Les refresh tokens sont tournants : les
 * faire tourner ailleurs que dans le CLI casserait le compte au prochain
 * démarrage. Le jeton d'accès vit ~8 h ; passé ce délai sans PC, la jauge se
 * déclare périmée — ce qui est honnête, contrairement à un zéro.
 *
 * `☠` Le REFRESH TOKEN n'est JAMAIS transmis, ni persisté au Pi. Seul le jeton
 * d'accès, de durée courte, traverse le lien.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JetonCompte } from './sonde-quotas-http.ts';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'jetons-comptes' });

interface CredentialsBrut {
  readonly claudeAiOauth?: {
    readonly accessToken?: string;
    readonly expiresAt?: number;
  };
}

/**
 * Lit le jeton d'un compte. Rend `null` — jamais une exception — quand le
 * fichier est absent, illisible ou d'une forme inattendue : un compte sans jeton
 * n'est pas une panne, c'est une jauge en moins.
 */
export async function lireJetonCompte(compteId: string, configDir: string): Promise<JetonCompte | null> {
  try {
    const brut = JSON.parse(await readFile(join(configDir, '.credentials.json'), 'utf8')) as CredentialsBrut;
    const oauth = brut.claudeAiOauth;
    if (typeof oauth?.accessToken !== 'string' || typeof oauth.expiresAt !== 'number') return null;
    return { compteId, jetonAcces: oauth.accessToken, expireA: oauth.expiresAt };
  } catch (erreur) {
    log.debug({ err: erreur, compteId }, 'jeton illisible — ce compte restera sans jauge fraîche');
    return null;
  }
}

export async function lireJetonsComptes(
  comptes: readonly { readonly id: string; readonly configDir: string }[],
): Promise<readonly JetonCompte[]> {
  const jetons = await Promise.all(comptes.map((c) => lireJetonCompte(c.id, c.configDir)));
  return jetons.filter((j): j is JetonCompte => j !== null);
}
