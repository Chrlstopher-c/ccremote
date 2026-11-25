// Responsabilité : faire renouveler le jeton OAuth expiré d'un compte avant son relevé d'usage. Le poste n'écrit jamais
// les identifiants : il lance un Claude Code minimal sur ce compte (`claude -p ok`, haiku, sans session gardée), qui
// renouvelle lui-même son jeton ; même méthode que le relais des invités (relais/invites/rafraichir-jeton.ts). Au plus
// une tentative par compte toutes les 30 min (un échec ne doit pas consommer le quota en boucle).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ECART_TENTATIVES_MS = 30 * 60_000;
const DELAI_MS = 60_000;
const PREFIXES_RETIRES = ['ANTHROPIC_', 'CLAUDE_CODE_OAUTH'];
const tentatives = new Map<string, number>();

export interface Lanceur {
  (executable: string, configDir: string | null): { readonly fini: Promise<number>; arreter(): void };
}

/** Vrai si une tentative est permise maintenant pour ce compte ; la note alors. */
export function tentativePermise(cle: string, maintenant: number): boolean {
  const avant = tentatives.get(cle);
  if (avant !== undefined && maintenant - avant < ECART_TENTATIVES_MS) return false;
  tentatives.set(cle, maintenant);
  return true;
}

function lancerMinimal(executable: string, configDir: string | null): { fini: Promise<number>; arreter(): void } {
  const dossier = mkdtempSync(join(tmpdir(), 'lanterne-jeton-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !PREFIXES_RETIRES.some((prefixe) => k.startsWith(prefixe))) env[k] = v;
  }
  if (configDir) env['CLAUDE_CONFIG_DIR'] = configDir;
  const p = Bun.spawn([executable, '-p', 'ok', '--model', 'haiku', '--no-session-persistence'], {
    cwd: dossier,
    env,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const fini = p.exited.finally(() => rmSync(dossier, { recursive: true, force: true }));
  return { fini, arreter: () => p.kill() };
}

/** Fait renouveler le jeton du compte ; vrai si Claude Code a fini sans erreur dans le délai. */
export async function renouvelerJeton(
  configDir: string | null,
  executable: string | null = Bun.which('claude'),
  lancer: Lanceur = lancerMinimal,
  maintenant: number = Date.now(),
): Promise<boolean> {
  if (!executable || !tentativePermise(configDir ?? 'defaut', maintenant)) return false;
  let p: ReturnType<Lanceur>;
  try {
    p = lancer(executable, configDir);
  } catch {
    return false;
  }
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<null>((ok) => (minuterie = setTimeout(() => ok(null), DELAI_MS)));
  const code = await Promise.race([p.fini.catch(() => -1), delai]);
  clearTimeout(minuterie);
  if (code === null) p.arreter();
  return code === 0;
}
