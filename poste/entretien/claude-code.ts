// Responsabilité : les versions de Claude Code de la machine — la CLI (`claude --version`, cinq secondes au plus) et le
// SDK (version du paquet installé avec le poste). Relevées une fois au démarrage, jamais bloquantes au-delà du délai.
import { createRequire } from 'node:module';
import type { Logger } from 'pino';
import type { VersionsClaude } from '../../commun/entretien.ts';

export const DELAI_CLI_MS = 5000;
export const PAQUET_SDK = '@anthropic-ai/claude-agent-sdk/package.json';

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

export function versionSdk(journal: Logger): string | null {
  try {
    const paquet = createRequire(import.meta.url)(PAQUET_SDK) as { version?: unknown };
    return typeof paquet.version === 'string' ? paquet.version : null;
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
