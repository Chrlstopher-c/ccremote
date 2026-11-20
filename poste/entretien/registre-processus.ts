// Responsabilité : le registre des processus lancés par le poste (`processus.json`, 0600). Il garde le PID, l'heure de
// démarrage et le lancement de chaque descendant, pour reconnaître après un redémarrage ce qui tourne encore.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';

const EntreeRegistre = z.object({
  pid: z.number().int(),
  debut: z.string(),
  session: z.string().nullable(),
  lancement: z.string(),
});
export type EntreeRegistre = z.infer<typeof EntreeRegistre>;

export interface DescendantVu {
  readonly pid: number;
  readonly debut: string;
  readonly session: string | null;
}

const cle = (e: { pid: number; debut: string }): string => `${e.pid}:${e.debut}`;

/**
 * Le nouveau contenu du registre : les descendants actuels (lancement courant), plus les entrées précédentes encore
 * vivantes avec la même heure de démarrage (restes). Les entrées mortes sont oubliées. Pur.
 */
export function nouveauRegistre(
  precedent: readonly EntreeRegistre[],
  descendants: readonly DescendantVu[],
  lancement: string,
  vivant: (pid: number, debut: string) => boolean,
): { registre: EntreeRegistre[]; restes: EntreeRegistre[] } {
  const actuels = descendants.map((d) => ({ pid: d.pid, debut: d.debut, session: d.session, lancement }));
  const connus = new Set(actuels.map(cle));
  const vus = new Set<string>();
  const restes = precedent.filter((e) => {
    if (connus.has(cle(e)) || vus.has(cle(e)) || !vivant(e.pid, e.debut)) return false;
    vus.add(cle(e));
    return true;
  });
  return { registre: [...actuels, ...restes], restes };
}

/** Lit le registre ; un fichier absent, abîmé ou invalide donne un registre vide (journalisé). */
export function lireRegistre(chemin: string, journal: Logger): EntreeRegistre[] {
  let brut: string;
  try {
    brut = readFileSync(chemin, 'utf8');
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT')
      journal.warn({ err: erreur }, 'registre des processus illisible');
    return [];
  }
  try {
    return z.array(EntreeRegistre).parse(JSON.parse(brut));
  } catch (erreur) {
    journal.warn({ err: erreur }, 'registre des processus abîmé, repart vide');
    return [];
  }
}

/** Écrit le registre en 0600, par fichier temporaire puis renommage (jamais à moitié écrit). Erreur journalisée. */
export function ecrireRegistre(chemin: string, entrees: readonly EntreeRegistre[], journal: Logger): void {
  const temporaire = `${chemin}.tmp`;
  try {
    mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 });
    writeFileSync(temporaire, JSON.stringify(entrees), { mode: 0o600 });
    renameSync(temporaire, chemin);
  } catch (erreur) {
    journal.warn({ err: erreur }, 'registre des processus non écrit');
  }
}
