// Responsabilité : la configuration d'un poste — fichier JSON local + secret en variable d'environnement.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const FichierConfig = z.object({
  machine: z.string().regex(/^[a-z0-9-]+$/),
  relais: z.string().regex(/^wss?:\/\//),
  description: z.string(),
  racines: z.array(z.string()),
  // id du compte → CLAUDE_CONFIG_DIR (null = la config Claude Code par défaut de l'utilisateur)
  comptes: z.record(z.string(), z.string().nullable()).default({ principal: null }),
  donnees: z.string().optional(),
  fenetreContexte: z.number().int().positive().default(1_000_000),
});

export interface ConfigPoste {
  readonly machine: string;
  readonly relais: string;
  readonly secret: string;
  readonly description: string;
  readonly racines: readonly string[];
  // Modifiable à chaud : un compte ajouté ou retiré depuis Quart vaut aussitôt pour les sessions à ouvrir.
  readonly comptes: Record<string, string | null>;
  readonly donnees: string;
  readonly fenetreContexte: number;
}

export function developper(chemin: string): string {
  return chemin === '~' || chemin.startsWith('~/') ? join(homedir(), chemin.slice(1)) : chemin;
}

function cheminConfig(): string {
  return process.env['CCREMOTE_CONFIG_POSTE'] ?? join(homedir(), '.config/ccremote/poste.json');
}

export function chargerConfig(): ConfigPoste {
  const chemin = cheminConfig();
  const brut = FichierConfig.parse(JSON.parse(readFileSync(chemin, 'utf8')));
  const secret = process.env['CCREMOTE_SECRET_POSTE'];
  if (!secret) throw new Error('CCREMOTE_SECRET_POSTE absent : le poste ne peut pas s’authentifier auprès du relais');
  return {
    ...brut,
    secret,
    racines: brut.racines.map(developper),
    comptes: Object.fromEntries(Object.entries(brut.comptes).map(([k, v]) => [k, v === null ? null : developper(v)])),
    donnees: developper(brut.donnees ?? '~/.local/share/ccremote/poste'),
  };
}

/** Réécrit la liste des comptes dans le fichier de config, sans toucher au reste (écriture atomique). */
export function enregistrerComptes(comptes: Readonly<Record<string, string | null>>): void {
  const chemin = cheminConfig();
  const brut = JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>;
  const temporaire = `${chemin}.tmp`;
  writeFileSync(temporaire, `${JSON.stringify({ ...brut, comptes }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaire, chemin);
}
