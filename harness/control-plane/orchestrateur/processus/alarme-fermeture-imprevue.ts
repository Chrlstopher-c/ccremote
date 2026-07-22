/**
 * Responsabilité : LA dette explicitement confiée à cette mission (H-60,
 * REPRISE.md) — brancher `GenerateurEntree.surFermetureImprevue` sur une
 * alarme RÉELLE. Aujourd'hui (avant ce fichier) l'instrumentation existe
 * (`entree/generateur-entree.ts`) mais ne sert à rien : rien ne l'écoute.
 *
 * Ce que « alarme réelle » signifie ici, et pourquoi :
 *
 *  1. **Toujours** : log `fatal` (visible via Log Watcher, déjà dans l'écosystème
 *     opérateur) + un incident persistant (`incidents.ts`), NDJSON, qui survit à
 *     la mort du process — même si le reste de cette fonction échoue.
 *     Motif : c'est la panne #1 de la grille de revue, celle qui « invalide le
 *     travail déjà fait » — elle DOIT rester visible même si personne ne
 *     regarde au moment exact où elle survient.
 *
 *  2. **Best-effort, borné** : une tentative de redémarrage automatique de LA
 *     session orchestrateur (même `sessionId`, `resume`), via un callback
 *     injecté — c'est le seul geste qui a un sens ici : contrairement à un
 *     worker (dont le flux mort laisse le reste du parc fonctionner), un flux
 *     d'entrée orchestrateur mort rend Chris SOURD à son bras droit (H-62).
 *     Ne rien tenter serait accepter une panne totale du canal principal.
 *
 *  3. **Borné, jamais infini** : un redémarreur qui boucle sans plafond sur une
 *     cause structurelle (ex. un bug qui ferme le flux à chaque tour) devient
 *     lui-même une panne silencieuse — un « ça a l'air de tourner » qui masque
 *     un orchestrateur qui redémarre en boucle sans jamais répondre. Réutilise
 *     `CompteurRelances`/`delaiBackoffMs` (déjà livrés, branche relance/B.3) :
 *     même politique que la relance de mission, appliquée ici au processus
 *     orchestrateur lui-même. Au plafond : alarme SANS tentative — silence
 *     interdit, mais action automatique arrêtée, intervention humaine requise.
 *
 * Ce que ce module NE fait PAS, et pourquoi : il n'envoie aucune notification
 * Discord/Web Push lui-même. Ce canal (H-59) est une décision de la branche
 * notifications, non livrée dans ce dépôt (aucune dépendance Discord/Push
 * n'existe dans `package.json`) — l'ajouter ici serait une dépendance externe
 * hors du périmètre de cette mission. La porte reste ouverte : `incidents.ts`
 * expose une trace lisible par un futur composant de notification (tail du
 * NDJSON, ou lecture via `JournalIncidentsOrchestrateur`), sans qu'aucune
 * migration ne soit nécessaire pour le brancher plus tard.
 */

import type { ContexteFermetureImprevue } from '../entree/index.ts';
import { CompteurRelances } from '../../../relance/compteur-relances.ts';
import { delaiBackoffMs } from '../../../relance/backoff.ts';
import { processusOrchestrateurLogger as journalDefaut } from './logger.ts';
import type { IncidentOrchestrateur, JournalIncidentsOrchestrateur } from './incidents.ts';

/** Plafond de tentatives de redémarrage automatique. Généreux mais fini (voir en-tête, point 3). */
export const PLAFOND_REDEMARRAGES_AUTOMATIQUES = 3;

export interface DependancesAlarmeFermeture {
  readonly sessionId: string;
  readonly incidents: JournalIncidentsOrchestrateur;
  /** Planifie une tentative de redémarrage dans `delaiMs`. Absent ⇒ pas de redémarrage automatique. */
  readonly redemarrer?: (delaiMs: number) => void;
  readonly compteurRelances?: CompteurRelances;
  readonly journal?: typeof journalDefaut;
  /** Horloge injectable — seulement pour l'estampille de l'incident, testable sans horloge réelle. */
  readonly maintenant?: () => number;
}

/**
 * Construit le callback à passer en `surFermetureImprevue` de `GenerateurEntree`.
 * Synchrone du point de vue de `GenerateurEntree` (le contrat de
 * `surFermetureImprevue` est `(contexte) => void`) — toute I/O est fire-and-forget
 * mais chaque étape logue son propre échec, jamais silencieusement.
 */
export function construireAlarmeFermetureImprevue(
  deps: DependancesAlarmeFermeture,
): (contexte: ContexteFermetureImprevue) => void {
  const journal = deps.journal ?? journalDefaut;
  const compteur = deps.compteurRelances ?? new CompteurRelances(PLAFOND_REDEMARRAGES_AUTOMATIQUES);
  const maintenant = deps.maintenant ?? (() => Date.now());

  return (contexte: ContexteFermetureImprevue): void => {
    const instant = maintenant();
    journal.fatal(
      { sessionId: deps.sessionId, ...contexte },
      "ALARME — flux d'entrée de l'orchestrateur fermé de façon non sollicitée : Chris est sourd à son bras droit",
    );

    const incident: IncidentOrchestrateur = {
      type: 'fermeture_flux_entree_imprevue',
      instant,
      details: { sessionId: deps.sessionId, ...contexte },
    };
    void Promise.resolve(deps.incidents.enregistrer(incident)).catch((erreur: unknown) => {
      journal.error({ err: erreur }, "échec de la persistance de l'incident — l'alarme reste dans les logs pino");
    });

    deciderRedemarrage(deps, compteur, journal);
  };
}

function deciderRedemarrage(
  deps: DependancesAlarmeFermeture,
  compteur: CompteurRelances,
  journal: typeof journalDefaut,
): void {
  if (deps.redemarrer === undefined) {
    journal.warn({ sessionId: deps.sessionId }, 'aucun redémarreur injecté — alarme journalisée seule, pas de reprise automatique');
    return;
  }
  if (!compteur.sousLePlafond(deps.sessionId)) {
    journal.fatal(
      { sessionId: deps.sessionId },
      'plafond de redémarrages automatiques atteint — arrêt des tentatives, INTERVENTION HUMAINE REQUISE',
    );
    return;
  }
  const etat = compteur.enregistrerTentative(deps.sessionId);
  const delaiMs = delaiBackoffMs(etat.tentativesEffectuees);
  journal.warn({ sessionId: deps.sessionId, tentative: etat.tentativesEffectuees, delaiMs }, 'tentative de redémarrage automatique planifiée');
  deps.redemarrer(delaiMs);
}
