// Responsabilité : le script moteur de la dictée (`moteur.sh demarrer|arreter|etat`) côté poste — découverte de son
// chemin, appel avec le dossier de socket (DICTEE_RUN) et un délai, lecture de la ligne d'état JSON. Jamais de shell :
// tableau d'arguments. Le poste ne connaît ni le GPU ni le modèle ; il ne fait que piloter ce script.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Le script peut charger un modèle : `demarrer` rend la main tout de suite, mais un blocage est coupé à ce délai. */
export const DELAI_SCRIPT_MS = 15_000;
export type ActionMoteur = 'demarrer' | 'arreter' | 'etat';
export interface SortieMoteur {
  readonly code: number;
  readonly sortie: string;
  readonly erreurs: string;
}
export type LanceurMoteur = (script: string, action: ActionMoteur, dossierRun: string) => Promise<SortieMoteur>;

const EtatMoteurLu = z.object({
  etat: z.enum(['arrete', 'demarrage', 'pret', 'erreur']),
  pid: z.number().int().nullable(),
  depuis: z.string().nullable(),
  chargementMs: z.number().nullable(),
  memoireGpuMo: z.number().nullable(),
  message: z.string().nullable(),
});
export type EtatMoteur = z.infer<typeof EtatMoteurLu>;

const MOTEUR_SOUS_PROJETS = join('projects', 'whisper', 'app', 'moteur.sh');
const MOTEUR_MONTE = '/mnt/projects/whisper/app/moteur.sh';

/** Le script du moteur : `LANTERNE_DICTEE_SCRIPT` s'il est posé (absent = non installé), sinon le premier existant. */
export function decouvrirScript(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  existe: (chemin: string) => boolean = existsSync,
): string | null {
  const explicite = env['LANTERNE_DICTEE_SCRIPT'];
  if (explicite) return existe(explicite) ? explicite : null;
  return [join(home, MOTEUR_SOUS_PROJETS), MOTEUR_MONTE].find((c) => existe(c)) ?? null;
}

/** La dernière ligne non vide d'une sortie, ou null. */
export function derniereLigne(sortie: string): string | null {
  const lignes = sortie
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lignes.at(-1) ?? null;
}

/** La ligne `{"etat":…}` du script ; null si elle est absente ou ne respecte pas la forme. */
export function lireEtatMoteur(sortie: string): EtatMoteur | null {
  const ligne = derniereLigne(sortie);
  if (ligne === null) return null;
  try {
    const lu = EtatMoteurLu.safeParse(JSON.parse(ligne));
    return lu.success ? lu.data : null;
  } catch {
    return null;
  }
}

/** Lance le script avec `DICTEE_RUN` ; au-delà de `DELAI_SCRIPT_MS`, le processus est arrêté et la sortie le dit. */
export async function lancerMoteur(script: string, action: ActionMoteur, dossierRun: string): Promise<SortieMoteur> {
  const proc = Bun.spawn([script, action], {
    env: { ...process.env, DICTEE_RUN: dossierRun },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let expire = false;
  const minuterie = setTimeout(() => {
    expire = true;
    proc.kill();
  }, DELAI_SCRIPT_MS);
  try {
    const [sortie, erreurs, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return expire ? { code: -1, sortie: '', erreurs: 'délai du service de dictée dépassé' } : { code, sortie, erreurs };
  } finally {
    clearTimeout(minuterie);
  }
}
