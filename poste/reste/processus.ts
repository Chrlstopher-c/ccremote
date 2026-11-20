// Responsabilité : lancer sur le poste un programme externe (git, gh) — tableau d'arguments, jamais de shell, dossier
// donné, délai borné. Le processus lancé ici est le seul arrêté ici ; un binaire absent est signalé, pas levé.
import type { Subprocess } from 'bun';
import type { Logger } from 'pino';

export type SortieProgramme =
  | { readonly absent: true; readonly erreur: string }
  | { readonly absent: false; readonly code: number; readonly sortie: string; readonly erreur: string };

/** Lance `argv` dans `cwd`, sans terminal ni invite ; au-delà de `delaiMs`, le processus est arrêté. */
export async function lancerProgramme(
  argv: readonly string[],
  cwd: string,
  delaiMs: number,
  journal: Logger,
): Promise<SortieProgramme> {
  let processus: Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    processus = Bun.spawn([...argv], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    });
  } catch (erreur) {
    journal.warn({ err: erreur, programme: argv[0] }, 'programme introuvable sur le poste');
    return { absent: true, erreur: String(erreur) };
  }
  let expire = false;
  const minuterie = setTimeout(() => {
    expire = true;
    processus.kill();
  }, delaiMs);
  try {
    const [sortie, erreur, code] = await Promise.all([
      new Response(processus.stdout).text(),
      new Response(processus.stderr).text(),
      processus.exited,
    ]);
    const erreurFinale = expire ? `délai de ${Math.round(delaiMs / 1000)} s dépassé` : erreur.trim();
    return { absent: false, code, sortie: sortie.trim(), erreur: erreurFinale };
  } finally {
    clearTimeout(minuterie);
  }
}

/** La première ligne non vide d'un texte de sortie, tronquée : ce qui s'affiche à Chris. */
export function premiereLigne(texte: string): string {
  const ligne = texte.split('\n').find((l) => l.trim() !== '') ?? '';
  return ligne.trim().slice(0, 300);
}
