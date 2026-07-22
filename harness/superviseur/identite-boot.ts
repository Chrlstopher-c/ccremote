/**
 * Responsabilité : identité du boot Linux courant, et comparaison avec
 * l'identité persistée d'un enregistrement (H-75 — dette n°1 après un
 * redémarrage de la machine, pas seulement du superviseur).
 *
 * `☠` Piège que ce fichier existe pour fermer : `starttime` (`revalidation-
 * process.ts`) est compté en ticks DEPUIS LE BOOT. Un redémarrage réattribue les
 * petits pid dans le même ordre, aux mêmes instants relatifs — un process du
 * nouveau boot peut porter le même `(pid, starttime)` qu'un worker de la veille.
 * Comparer l'identité du boot AVANT toute lecture de `/proc/<pid>/stat` élimine
 * ce cas sans ambiguïté : après un redémarrage, tout ce qui précède est mort.
 *
 * Source, dans cet ordre de préférence : `/proc/sys/kernel/random/boot_id`
 * (UUID, vérifié disponible sur cette machine), sinon `btime` de `/proc/stat`
 * (secondes Unix du boot). Une lecture impossible retourne `null` — un FAIT à
 * traiter comme `indetermine` par l'appelant, jamais comme un boot différent.
 */

import { readFileSync } from 'node:fs';
import { superviseurLogger } from './logger.ts';

export type LecteurBootId = () => string | null;

/** Lit l'identité du boot courant. `null` si aucune des deux sources n'est lisible. */
export function lireBootIdProc(): string | null {
  const bootIdKernel = lireBootIdKernel();
  if (bootIdKernel !== null) return bootIdKernel;
  return lireBtimeProcStat();
}

function lireBootIdKernel(): string | null {
  try {
    const contenu = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return contenu.length > 0 ? contenu : null;
  } catch (erreur) {
    superviseurLogger.debug({ err: erreur }, 'lecture /proc/sys/kernel/random/boot_id impossible, repli sur btime');
    return null;
  }
}

function lireBtimeProcStat(): string | null {
  try {
    const contenu = readFileSync('/proc/stat', 'utf8');
    const ligneBtime = contenu.split('\n').find((ligne) => ligne.startsWith('btime '));
    if (ligneBtime === undefined) return null;
    const valeur = ligneBtime.trim().split(/\s+/)[1];
    return valeur ?? null;
  } catch (erreur) {
    superviseurLogger.debug({ err: erreur }, 'lecture /proc/stat (btime) impossible');
    return null;
  }
}

export type EtatComparaisonBoot = 'meme_boot' | 'boot_differe' | 'indetermine';

/**
 * `☠` Biais asymétrique non négociable (dette n°1, H-75) : un `boot_id`
 * illisible d'un côté ou de l'autre ne doit JAMAIS produire `boot_differe` —
 * seulement `indetermine`. `restauration-registre.ts` traite `indetermine`
 * comme « ne jamais libérer le worktree », exactement comme un `pid`/
 * `starttime` illisible.
 */
export function comparerBootId(bootIdEnregistre: string | null, bootIdCourant: string | null): EtatComparaisonBoot {
  if (bootIdEnregistre === null || bootIdCourant === null) return 'indetermine';
  return bootIdEnregistre === bootIdCourant ? 'meme_boot' : 'boot_differe';
}
