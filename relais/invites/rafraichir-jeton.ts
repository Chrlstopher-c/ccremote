// Responsabilité : faire renouveler le jeton OAuth du compte Claude du chef quand le relais d'invités le trouve expiré.
// Le relais n'écrit jamais les identifiants : il lance un Claude Code minimal sur ce compte (lui seul les renouvelle),
// un seul à la fois, avec un délai borné. L'appelant relit ensuite le jeton.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';

export interface ProcessusLance {
  readonly fini: Promise<number>;
  arreter(): void;
}

export interface OptionsRafraichissement {
  readonly journal: Logger;
  readonly delaiMs: number;
  readonly lancer: () => ProcessusLance;
}

export const DELAI_RAFRAICHISSEMENT_MS = 60_000;
const PREFIXES_RETIRES = ['ANTHROPIC_', 'CLAUDE_CODE_OAUTH'];

export class RafraichisseurJeton {
  private enCours: Promise<boolean> | null = null;

  constructor(private readonly o: OptionsRafraichissement) {}

  /** Un seul rafraîchissement à la fois : les appels simultanés partagent son issue. */
  rafraichir(): Promise<boolean> {
    this.enCours ??= this.une().finally(() => {
      this.enCours = null;
    });
    return this.enCours;
  }

  private async une(): Promise<boolean> {
    let p: ProcessusLance;
    try {
      p = this.o.lancer();
    } catch (erreur) {
      this.o.journal.error({ err: erreur }, 'jeton du chef : Claude Code impossible à lancer');
      return false;
    }
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const delai = new Promise<null>((ok) => (minuterie = setTimeout(() => ok(null), this.o.delaiMs)));
    const code = await Promise.race([p.fini.catch(() => -1), delai]);
    clearTimeout(minuterie);
    if (code === null) {
      p.arreter();
      this.o.journal.error({ delaiMs: this.o.delaiMs }, 'jeton du chef : rafraîchissement trop long, arrêté');
      return false;
    }
    if (code !== 0) this.o.journal.error({ code }, 'jeton du chef : rafraîchissement en échec');
    else this.o.journal.info('jeton du chef : rafraîchi par Claude Code');
    return code === 0;
  }
}

/** `claude -p` minimal (haiku, sans session gardée) dans un dossier temporaire, sans variable d'authentification. */
export function lancerClaudeMinimal(executable: string): ProcessusLance {
  const dossier = mkdtempSync(join(tmpdir(), 'lanterne-jeton-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !PREFIXES_RETIRES.some((prefixe) => k.startsWith(prefixe))) env[k] = v;
  }
  const p = Bun.spawn([executable, '-p', 'ok', '--model', 'haiku', '--no-session-persistence'], {
    cwd: dossier,
    env,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true,
  });
  const fini = p.exited.finally(() => rmSync(dossier, { recursive: true, force: true }));
  return { fini, arreter: () => p.kill() };
}
