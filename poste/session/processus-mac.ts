// Responsabilité : lire un processus Claude sous macOS (ps) au format d'`EtatProcessus` : nom, binaire, heure
// de démarrage (battements depuis le démarrage, comme /proc) et présence de TMUX. Les lectures sont dans proc-mac.
import { environnementMac, lireProcessusMac } from '../entretien/proc-mac.ts';
import type { EtatProcessus } from './processus.ts';

/** L'état d'un processus à partir de son entrée `ps` et de son environnement brut. */
export function etatDepuisPs(comm: string, commande: string, demarrage: string, environnement: string): EtatProcessus {
  return {
    comm,
    exe: commande.split(' ')[0] ?? '',
    demarrage,
    enTmux: /(^|\s)TMUX=/.test(environnement),
  };
}

/** Lecture réelle d'un processus macOS ; null s'il a disparu. */
export function lecteurProcessusMac(pid: number): EtatProcessus | null {
  const entree = lireProcessusMac(pid);
  if (entree === null) return null;
  return etatDepuisPs(entree.comm, entree.commande, entree.debut, environnementMac(pid));
}
