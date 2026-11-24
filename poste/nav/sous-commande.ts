// Responsabilité : la sous-commande `nav` du binaire compilé (`lanterne-moteur nav <dossier> <args>`) : elle exécute la
// CLI extraite dans <dossier> (cli.mjs, à côté de client.mjs) avec le runtime du binaire. Le lanceur extrait y renvoie
// quand node n'est pas installé.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SortiesCli } from './cli.d.mts';

export async function executerSousCommandeNav(
  dossier: string,
  argv: readonly string[],
  sorties?: SortiesCli,
): Promise<void> {
  const cli: typeof import('./cli.mjs') = await import(pathToFileURL(join(dossier, 'cli.mjs')).href);
  process.exitCode = await cli.executerCli(argv, sorties);
}
