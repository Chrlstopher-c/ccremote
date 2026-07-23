/**
 * Responsabilité : formes de données et dépendances de `SuperviseurWorkers`.
 * Extrait de `superviseur-workers.ts` pour respecter la limite de 500 lignes
 * (dette n°4a, TODO.md) — aucun changement de comportement, purement structurel.
 */

import type { JugeBoucle } from '../anti-boucle/index.ts';
import type { ObservateurUsage } from '../budgets/index.ts';
import type { CompteurRelances } from '../relance/compteur-relances.ts';
import type { StartWorkerDeps } from '../workers/index.ts';
import { startWorker as startWorkerReel } from '../workers/index.ts';
import type { ConfigAntiBoucle, ObservateurAntiBoucle } from './anti-boucle-workers.ts';
import type { PersistanceRegistre } from './persistance-registre.ts';
import type { ObservateurFlux, ObservateurRelance } from './types.ts';

/**
 * Fenêtre de grâce par défaut avant le forçage (G.4.2, mission M-52).
 *
 * `⚠ NON TRANCHÉE — dette n°2a, TODO.md`. Relu intégralement contre
 * `05-arbre-B-workers.md` (branche assignée) : ce document ne quantifie NULLE
 * PART la durée d'une écriture worker. La seule donnée temporelle qu'il porte est
 * B.1.5 — « `close()` ... fenêtre de grâce ~2 s, le CLI exécute son arrêt
 * gracieux » — reprise de `01-verification-sdk.md` (fenêtre CLI **interne**,
 * post `stdin` EOF, avant que `SpawnedProcess` ne délivre `'exit'`). C'est le
 * délai que le CLI s'accorde à LUI-MÊME pour terminer son propre arrêt propre —
 * PAS une mesure de « combien de temps met un worker à finir d'écrire un
 * fichier/git commit/outil en cours » au moment où l'arrêt d'urgence le
 * surprend. Aucun des deux paquets (`05-arbre-B`, `01-verification-sdk`) ne
 * fournit cette seconde mesure.
 *
 * Implication pour la valeur ci-dessous : elle DOIT rester strictement
 * supérieure aux ~2 s de B.1.5 (sinon le forçage intervient avant même que le
 * CLI ait fini son propre arrêt gracieux) — 5000 ms respecte cette seule
 * contrainte connue. Au-delà, RIEN dans le paquet ne permet de dire si 5000 ms
 * est trop court (écriture longue interrompue) ou trop long (bouton d'urgence
 * qui traîne) : reste un défaut délibérément configurable
 * (`arretUrgence(graceMs)`), PAS une valeur dérivée d'une mesure.
 *
 * Ce qui manque pour trancher réellement (à remonter, jamais à deviner) : une
 * MESURE du pire cas d'écriture d'un worker en tour (taille de fichier typique,
 * durée d'un `git commit`/`git worktree` sous charge, temps entre un signal et
 * la fin réelle d'un outil Bash en vol) — donnée absente de toute la spec
 * `Upgrade/`.
 */
export const GRACE_ARRET_URGENCE_MS_DEFAUT = 5000;

export class SuperviseurError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperviseurError';
  }
}

/** Signature de `startWorker`, isolée pour l'injection en test (jamais de spawn réel en unitaire). */
export type DemarrerWorkerFn = typeof startWorkerReel;

export interface DependancesSuperviseur {
  readonly compteurRelances: CompteurRelances;
  /** Best-effort (H-15) : la remontée réelle vers le Pi passe par E.2, hors périmètre. */
  readonly observateurRelance?: ObservateurRelance;
  /**
   * Best-effort (H-15, mission M-51) : quotas (`rate_limit_event`) et messages d'usage
   * classifiés (G.1.4). Même contrat que `observateurRelance` — aucune connexion ouverte.
   */
  readonly observateurUsage?: ObservateurUsage;
  /**
   * Client d'observabilité temps réel (E.2, mission M-50) — best-effort
   * (H-15), jamais bloquant. Reçoit CHAQUE message déjà lu par l'unique
   * consommateur ci-dessous, avant toute autre interprétation.
   */
  readonly observateurFlux?: ObservateurFlux;
  /** Injectable pour les tests : jamais de spawn réel en unitaire (règle du dépôt). */
  readonly demarrerWorker?: DemarrerWorkerFn;
  readonly startWorkerDeps?: StartWorkerDeps;
  /**
   * Racine des projets sur le PC, borne de `explorerProjets`. Défaut
   * `/mnt/projects` — l'emplacement réel des projets de l'opérateur.
   */
  readonly racineProjets?: string;
  /**
   * Comptes Claude à sonder pour mesurer l'usage des fenêtres de rate limit.
   * `☠` Absents ⇒ aucune sonde : les jauges restent non mesurées, ce qui est
   * honnête. Elles affichaient 0 % en permanence avant cette mesure (23/07).
   */
  readonly comptesASonder?: readonly { readonly id: string; readonly configDir: string }[];
  /** Ordonnancement du délai de backoff avant une relance. Réel = `setTimeout`, synchrone en test. */
  readonly planifier?: (delaiMs: number, tache: () => void) => void;
  /**
   * Fenêtre de grâce de l'arrêt d'urgence (G.4.2, mission M-52), attendue entre
   * la fermeture propre et le forçage. Réel = `setTimeout`, contrôlable en test
   * (jamais une vraie attente dans un test unitaire).
   */
  readonly attendreGrace?: (delaiMs: number) => Promise<void>;
  /**
   * Persistance disque du registre (dette n°1, TODO.md). Absente ⇒ comportement
   * inchangé, strictement en mémoire (défaut historique). Présente ⇒ chaque
   * `enregistrer`/`marquerMort`/`remplacer` écrit à travers, et `restaurer()`
   * devient exploitable au démarrage.
   */
  readonly persistance?: PersistanceRegistre;
  /**
   * Terminaison réelle d'un concurrent restauré (dette n°1) — injectable pour les
   * tests : jamais de vrai `process.kill()` en unitaire (règle du dépôt). Réel =
   * `process.kill`.
   */
  readonly terminerConcurrentRestaure?: (pid: number, signal: NodeJS.Signals) => void;
  /**
   * Juge anti-boucle (H-68, mission M-53) — `☠ H-74` : DEVRAIT être obligatoire. Reste
   * optionnel ici uniquement parce que tous les sites d'appel actuels de ce constructeur sont
   * des tests préexistants hors périmètre de cette mission (aucun appelant de production
   * n'existe encore, vérifié par grep) ; les corriger tous aurait débordé le périmètre
   * `superviseur/` de cette mission et heurté l'interdiction de modifier des tests existants.
   * Absence rendue BRUYANTE au lieu de silencieuse : voir `anti-boucle-workers.ts`
   * (`CablageAntiBoucle`, log `warn` au démarrage). Tout nouveau site de production doit
   * fournir un vrai `JugeBoucle`.
   */
  readonly jugeBoucle?: JugeBoucle;
  /** Paliers/seuil d'escalade (H-68) — défauts de `anti-boucle/types.ts` si absent. */
  readonly configAntiBoucle?: ConfigAntiBoucle;
  /** Best-effort (H-15, H-64) : trace chaque décision anti-boucle dans le fil de la mission. */
  readonly observateurAntiBoucle?: ObservateurAntiBoucle;
}
