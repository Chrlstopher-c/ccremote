// Responsabilité : comparer deux contenus de fichier avec `git diff --no-index`, sur des fichiers temporaires du
// dossier de données du poste (jamais /tmp). Un contenu absent se compare comme un fichier vide.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';

export function sortieDiffNoIndex(
  dossierTemp: string,
  avant: Buffer | null,
  apres: Buffer | null,
  args: readonly string[],
  journal: Logger,
): string {
  mkdirSync(dossierTemp, { recursive: true, mode: 0o700 });
  const base = join(dossierTemp, randomUUID());
  const fichierAvant = `${base}-avant`;
  const fichierApres = `${base}-apres`;
  try {
    writeFileSync(fichierAvant, avant ?? new Uint8Array(0), { mode: 0o600 });
    writeFileSync(fichierApres, apres ?? new Uint8Array(0), { mode: 0o600 });
    const processus = Bun.spawnSync(
      ['git', 'diff', '--no-index', '--no-ext-diff', '--no-color', ...args, fichierAvant, fichierApres],
      { stdout: 'pipe', stderr: 'pipe', cwd: dossierTemp, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
    // `git diff --no-index` rend 1 quand les contenus diffèrent : ce n'est pas une erreur.
    if (processus.exitCode > 1) {
      const message = new TextDecoder().decode(processus.stderr).trim();
      journal.error({ code: processus.exitCode, message }, 'git diff --no-index en échec');
      throw new Error(`diff impossible : ${message}`);
    }
    return new TextDecoder().decode(processus.stdout);
  } finally {
    rmSync(fichierAvant, { force: true });
    rmSync(fichierApres, { force: true });
  }
}

/** Ajouts et retraits de la sortie de `git diff --no-index --numstat` (une seule ligne `a<TAB>r<TAB>chemin`). */
export function comptesDeDeux(sortie: string): { ajouts: number; suppressions: number; binaire: boolean } {
  const [ajouts = '', retraits = ''] = sortie.split('\t');
  const nombre = (valeur: string): number => {
    const n = Number.parseInt(valeur, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    ajouts: nombre(ajouts),
    suppressions: nombre(retraits),
    binaire: ajouts === '-' || retraits === '-',
  };
}
