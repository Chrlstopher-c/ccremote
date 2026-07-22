/**
 * Responsabilité : revalider un pid persisté contre l'état réel du système Linux
 * (dette n°1, TODO.md). Un pid recyclé par le noyau ne doit JAMAIS faire passer un
 * worker mort pour vivant — ni l'inverse. D'où la comparaison du `starttime`
 * (22e champ de `/proc/<pid>/stat`), pas la seule existence du pid.
 *
 * `☠` Piège classique de ce fichier : le 2e champ (`comm`) est encadré de
 * parenthèses et PEUT lui-même contenir des espaces et des parenthèses (nom de
 * process arbitraire). Le seul découpage sûr cherche la DERNIÈRE `)` de la ligne,
 * jamais un split naïf sur les espaces depuis le début.
 */

import { readFileSync } from 'node:fs';
import { superviseurLogger } from './logger.ts';
import type { EtatRevalidationProcess } from './types.ts';

export type { EtatRevalidationProcess };

/**
 * `starttime` est le 22e champ de `/proc/<pid>/stat`. Compté à partir de la
 * dernière `)` (fin de `comm`) : `state` est le 1er champ après `)`, donc
 * `starttime` est le 20e champ après `)` — index 19 en base 0.
 */
const INDEX_STARTTIME_APRES_COMM = 19;

export type LecteurStarttime = (pid: number) => string | null;

/**
 * Lit le `starttime` (ticks d'horloge depuis le boot) du process `pid`.
 * `null` si le process n'existe pas (ESRCH/ENOENT) ou si `/proc` est illisible pour
 * toute autre raison — jamais une exception : l'absence est un FAIT à traiter, pas
 * une panne à propager.
 */
export function lireStarttimeProc(pid: number): string | null {
  try {
    const contenu = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const finComm = contenu.lastIndexOf(')');
    if (finComm === -1) return null;
    const champsApresComm = contenu
      .slice(finComm + 1)
      .trim()
      .split(/\s+/);
    return champsApresComm[INDEX_STARTTIME_APRES_COMM] ?? null;
  } catch (erreur) {
    superviseurLogger.debug({ err: erreur, pid }, 'lecture /proc/<pid>/stat impossible (process probablement absent)');
    return null;
  }
}

/**
 * `☠ Biais asymétrique non négociable` (dette n°1) : dans le doute, `indetermine`.
 * Trois issues EXHAUSTIVES, jamais deux confondues :
 *  - `vivant_confirme` — le pid existe ET son starttime correspond exactement.
 *  - `mort_confirme`   — le pid n'existe plus, OU son starttime diffère (pid recyclé
 *    par un autre process depuis).
 *  - `indetermine`     — aucune donnée exploitable pour trancher (pid ou starttime
 *    attendu absents, ex. worker jamais encore relié à une voie de capture du pid —
 *    voir `types.ts`, `EnregistrementWorker.pid`).
 */
export function revaliderProcess(
  pid: number | null,
  pidStarttimeAttendu: string | null,
  lireStarttime: LecteurStarttime = lireStarttimeProc,
): EtatRevalidationProcess {
  if (pid === null || pidStarttimeAttendu === null) return 'indetermine';
  const starttimeActuel = lireStarttime(pid);
  if (starttimeActuel === null) return 'mort_confirme';
  return starttimeActuel === pidStarttimeAttendu ? 'vivant_confirme' : 'mort_confirme';
}
