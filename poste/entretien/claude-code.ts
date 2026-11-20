// Responsabilité : les versions de Claude Code de la machine — la CLI (`claude --version`, cinq secondes au plus) et le
// SDK (version du paquet installé avec le poste). Relevées une fois au démarrage, jamais bloquantes au-delà du délai.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Logger } from 'pino';
import type { VersionsClaude } from '../../commun/entretien.ts';

export const DELAI_CLI_MS = 5000;

/** Le numéro de version dans la sortie de `claude --version` (« 2.0.31 (Claude Code) » → « 2.0.31 »). */
export function extraireVersion(sortie: string): string | null {
  return /\d+(?:\.\d+)+/.exec(sortie)?.[0] ?? null;
}

export async function versionCli(executable: string | null, journal: Logger): Promise<string | null> {
  if (!executable) return null;
  try {
    const p = Bun.spawn([executable, '--version'], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const minuterie = setTimeout(() => p.kill(), DELAI_CLI_MS);
    try {
      const [code, sortie] = await Promise.all([p.exited, new Response(p.stdout).text()]);
      return code === 0 ? extraireVersion(sortie) : null;
    } finally {
      clearTimeout(minuterie);
    }
  } catch (erreur) {
    journal.warn({ err: erreur }, 'claude --version impossible');
    return null;
  }
}

/** Le package.json du SDK, retrouvé en remontant depuis son point d'entrée (son champ `exports` interdit l'import
 *  direct de `package.json`). */
function lirePaquetSdk(): string | null {
  let dossier = dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk'));
  for (let i = 0; i < 4; i += 1) {
    const chemin = join(dossier, 'package.json');
    if (existsSync(chemin)) {
      const paquet: unknown = JSON.parse(readFileSync(chemin, 'utf8'));
      const version = typeof paquet === 'object' && paquet !== null && 'version' in paquet ? paquet.version : null;
      return typeof version === 'string' ? version : null;
    }
    dossier = dirname(dossier);
  }
  return null;
}

/** Version du SDK : inscrite à la compilation du moteur (`QUART_SDK_VERSION`), sinon lue dans le paquet installé. */
export function versionSdk(journal: Logger): string | null {
  if (process.env.QUART_SDK_VERSION) return process.env.QUART_SDK_VERSION;
  try {
    return lirePaquetSdk();
  } catch (erreur) {
    journal.warn({ err: erreur }, 'version du SDK illisible');
    return null;
  }
}

/** Les deux versions : la CLI d'après CCREMOTE_CLAUDE (ou le PATH), le SDK d'après son paquet. */
export async function versionsClaudeCode(journal: Logger): Promise<VersionsClaude> {
  const executable = process.env['CCREMOTE_CLAUDE'] || Bun.which('claude');
  return { cli: await versionCli(executable ?? null, journal), sdk: versionSdk(journal) };
}
