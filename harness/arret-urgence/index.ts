/**
 * Interface publique du module `arret-urgence` — drill récurrent de l'arrêt
 * d'urgence (G.4.3, mission M-52). Aucun autre module ne doit importer les
 * fichiers internes de ce dossier.
 *
 * ☠ Le déclenchement réel « tout arrêter » (G.4.1/G.4.2) ne vit PAS ici : il
 * vit dans `superviseur/superviseur-workers.ts`
 * (`arretUrgence()`/`arreterMissionEnUrgence()`) et est atteint via
 * `superviseur/canal-controle.ts` (opération `arret_urgence`). Ce module-ci
 * est UNIQUEMENT le banc qui prouve, à intervalle, que ce chemin fonctionne
 * encore (acceptation d).
 *
 * `PortDrillCanariProcess` (dette n°2, TODO.md) branche ce banc sur une cible
 * réelle : un process OS trivial, jamais une session Claude Code, jamais le
 * chemin de production `superviseur/` — voir son en-tête pour l'isolation
 * structurelle vis-à-vis d'une vraie mission.
 */

export {
  VerificateurDrillArretUrgence,
  type OptionsVerificateurDrill,
  type PoigneePlanification,
} from './exercice-periodique.ts';

export {
  ETAPE_PREUVE_COMPLETE,
  type AlerteDrill,
  type EtatDrill,
  type MotifAlerte,
  type PortDrillArretUrgence,
} from './types.ts';

export { arretUrgenceLogger } from './logger.ts';

export { PortDrillCanariProcess, type OptionsCanariProcess } from './canari-process.ts';
