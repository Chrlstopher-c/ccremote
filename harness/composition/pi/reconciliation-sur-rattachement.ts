/**
 * Responsabilité : câble le déclencheur `'reconnexion'` de `reconcilier()`
 * (`control-plane/reconciliation/index.ts`, D.2.4) sur CHAQUE rattachement
 * réel du PC (H-75, point 3 — « l'epoch incrémenté à chaque rattachement »).
 *
 * `☠ CE QUI MANQUAIT` — avant cette mission, seul `'demarrage'` était câblé
 * (`control-plane/orchestrateur/processus/demarrage.ts`, au lancement du Pi).
 * Aucun site de production n'appelait `reconcilier(..., 'reconnexion')` — le
 * déclencheur existait dans le type (`DeclencheurReconciliation`) sans jamais
 * être atteint après une coupure réseau, seulement après un redémarrage
 * complet du Pi. C'est la composition, seule à connaître À LA FOIS le lien
 * réseau et les dépendances de réconciliation, qui pouvait fermer cet écart.
 *
 * Où l'epoch est réellement incrémenté (vérifié, pas supposé) : `control-
 * plane/reconciliation/reconciliation.ts#traiterOrphelins`, via
 * `registre.missions.incrementerEpoch(missionConnue.id)` — UNIQUEMENT pour un
 * orphelin ADOPTÉ (worker vivant sur le PC, mission connue mais pas active).
 * Une mission déjà `en_cours` et retrouvée vivante (pas un orphelin) ne
 * déclenche PAS d'incrément — c'est correct : elle n'a jamais été perdue de
 * vue, aucune ambiguïté de fencing à lever. `arbitrerFencing` (`superviseur/
 * fencing-epoch.ts`, hors zone) reste la seule autorité qui REFUSE un
 * rattachement au même epoch — cette fonction ne fait qu'assurer que
 * `reconcilier()` tourne à chaque rattachement, pas à chaque démarrage
 * seulement.
 *
 * `☠` Ne DOIT jamais lancer de mission (H-75 : « rien de mutant ne s'exécute
 * au rattachement ») — vérifié par lecture de `reconciliation.ts` :
 * `traiterOrphelins`/`traiterMissionsActives` marquent, adoptent ou tuent,
 * n'appellent jamais `demarrer()`. Cette fonction ne fait qu'invoquer
 * `reconcilier()` tel quel, elle n'ajoute aucune décision.
 *
 * Jamais bruyant en cas d'absence prolongée du PC (H-75, tolérance à
 * l'absence) : un échec de `reconcilier()` est journalisé, jamais relancé en
 * boucle serrée ni traité comme une alarme distincte d'un PC simplement lent.
 */

import { reconcilier, type DependancesReconciliation } from '../../control-plane/reconciliation/index.ts';
import type { Registre } from '../../control-plane/registre/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'reconciliation-sur-rattachement' });

/**
 * Retourne le callback à passer à `OptionsServeurLienPc.surConnexionAcceptee`
 * (`composition/pi/serveur-lien-pc.ts`). Fire-and-forget assumé : une
 * connexion entrante ne doit jamais attendre la fin de la réconciliation
 * pour être considérée établie.
 */
export function creerDeclencheurReconciliationSurRattachement(registre: Registre, deps: DependancesReconciliation): () => void {
  return (): void => {
    void reconcilier(registre, deps, 'reconnexion')
      .then((rapport) => log.info({ rapport }, 'réconciliation exécutée sur rattachement du PC (H-75)'))
      .catch((erreur: unknown) => log.error({ err: erreur }, 'réconciliation en échec sur rattachement du PC — rattachement conservé, prochain tic la retentera'));
  };
}
