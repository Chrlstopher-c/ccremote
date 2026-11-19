// Responsabilité : les plug-ins Claude de la machine — liste (`claude plugin list --json`), description tirée du
// manifeste, activation ou désactivation par la CLI.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { PluginMachine } from '../../commun/configuration.ts';
import { type LanceurClaude, messageEchec } from './exec.ts';

const PluginBrut = z.object({
  id: z.string(),
  version: z.string(),
  scope: z.string(),
  enabled: z.boolean(),
  installPath: z.string().optional(),
});
export type PluginBrut = z.infer<typeof PluginBrut>;

export type ResultatPlugin =
  { readonly ok: true; readonly plugin: PluginMachine } | { readonly ok: false; readonly erreur: string };

export async function lirePlugins(lancer: LanceurClaude, journal: Logger): Promise<PluginBrut[]> {
  const r = await lancer(['plugin', 'list', '--json']);
  if (r.code !== 0) {
    journal.warn({ erreur: messageEchec(r) }, 'liste des plug-ins impossible');
    return [];
  }
  return analyserPlugins(r.sortie, journal);
}

export function analyserPlugins(json: string, journal: Logger): PluginBrut[] {
  let brut: unknown;
  try {
    brut = JSON.parse(json);
  } catch (erreur) {
    journal.warn({ err: erreur }, 'sortie des plug-ins illisible');
    return [];
  }
  const lus = z.array(PluginBrut).safeParse(brut);
  if (!lus.success) {
    journal.warn({ erreur: lus.error.message }, 'forme des plug-ins inattendue');
    return [];
  }
  return lus.data;
}

export function pluginAffiche(p: PluginBrut, journal: Logger): PluginMachine {
  return {
    id: p.id,
    version: p.version,
    portee: p.scope,
    actif: p.enabled,
    description: descriptionDe(p.installPath, journal),
  };
}

export async function activerPlugin(
  lancer: LanceurClaude,
  id: string,
  actif: boolean,
  journal: Logger,
): Promise<ResultatPlugin> {
  const r = await lancer(['plugin', actif ? 'enable' : 'disable', id]);
  if (r.code !== 0) return { ok: false, erreur: messageEchec(r) };
  const trouve = (await lirePlugins(lancer, journal)).find((p) => p.id === id);
  return trouve ? { ok: true, plugin: pluginAffiche(trouve, journal) } : { ok: false, erreur: 'plug-in introuvable' };
}

function descriptionDe(installPath: string | undefined, journal: Logger): string {
  if (!installPath) return '';
  const manifeste = join(installPath, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifeste)) return '';
  try {
    const lu = z.object({ description: z.string().optional() }).safeParse(JSON.parse(readFileSync(manifeste, 'utf8')));
    return lu.success ? (lu.data.description ?? '') : '';
  } catch (erreur) {
    journal.warn({ err: erreur, manifeste }, 'manifeste de plug-in illisible');
    return '';
  }
}
