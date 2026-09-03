/**
 * Responsabilité : ce qui se passe côté Pi à la FIN D'UNE ACTIVATION de team
 * persistante (axe B, lot B-b). Une activation = une mission ; quand elle se
 * conclut (mort constatée du worker), la team ne meurt PAS avec elle :
 *
 *  1. la team `active` redevient `dormante` (elle survit, réveillable) ;
 *  2. son worktree est CONSERVÉ en veille côté PC (pas de `git worktree remove`) —
 *     `arreter(missionId, { conserverWorktree: true })`, routé par le port ;
 *  3. la file de features (B2) est DÉPILÉE : la première `en_attente` du même
 *     (projet, domaine) est re-dispatchée par le MÊME chemin `dispatcherMandat`
 *     (H-61) — AUTOMATIQUEMENT sous fenêtre d'autonomie (D4), sinon elle attend
 *     un clic humain.
 *
 * `☠` Ce module vit sur le Pi (registre `team`/`feature_queue`), mais la
 * conservation du worktree est une action PC : elle passe par le port
 * `conserverWorktreeTeam`, jamais un import direct control-plane ↔ superviseur
 * (frontière A↔B). Le re-dispatch passe par le port `redispatcher`, qui est
 * `dispatcherMandat` en composition — le seul créateur réel d'équipe (H-61).
 *
 * `☠` Best-effort partout où l'action est externe (conservation worktree,
 * re-dispatch) : un échec est journalisé et laisse l'état cohérent (feature
 * remise en file), jamais une exception qui remonterait interrompre le balayage.
 */

import type { Proposition, Registre } from '../registre/index.ts';
import type { ResultatDispatch } from './dispatch-mandat.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'fin-activation-team' });

export interface DependancesFinActivation {
  readonly registre: Registre;
  /**
   * Endort la team côté PC en CONSERVANT son worktree en veille —
   * `arreter(missionId, { conserverWorktree: true })` routé vers la machine.
   * Best-effort : un échec ne bloque jamais l'endormissement de la team côté Pi.
   */
  readonly conserverWorktreeTeam: (missionId: string) => Promise<void>;
  /**
   * La conversation d'origine est-elle SOUS FENÊTRE D'AUTONOMIE (D4) ? Si oui, la
   * file se dépile seule ; sinon la feature attend un clic humain (H-61).
   */
  readonly fenetreAutonomieActive: (conversationId: string | null) => boolean;
  /**
   * Re-dispatch d'une proposition dépilée. `☠` C'est `dispatcherMandat` en
   * composition — le MÊME chemin que le clic humain (H-61), le seul créateur réel.
   */
  readonly redispatcher: (proposition: Proposition) => Promise<ResultatDispatch>;
}

/** Issue d'un traitement de fin d'activation — un fait distinct par branche, jamais confondus. */
export type IssueFinActivation =
  | { readonly type: 'hors_team' }
  | { readonly type: 'endormie'; readonly teamId: string }
  | { readonly type: 'file_attente'; readonly teamId: string; readonly featureId: string }
  | {
      readonly type: 'depilee';
      readonly teamId: string;
      readonly featureId: string;
      readonly resultat: ResultatDispatch;
    };

/**
 * Traite la fin d'une activation. `☠` `maintenant` INJECTÉ (jamais `Date.now()`
 * en dur au point d'usage) pour rester testable. Rend l'issue pour journal/preuve.
 */
export async function traiterFinActivationTeam(
  deps: DependancesFinActivation,
  missionId: string,
  maintenant: number = Date.now(),
): Promise<IssueFinActivation> {
  const mission = deps.registre.missions.lire(missionId);
  const teamId = mission?.teamId ?? null;
  if (mission === null || teamId === null) return { type: 'hors_team' };

  const team = deps.registre.teams.lire(teamId);
  // `☠` Team démantelée (TTL/dissolution pendant l'activation) : rien à endormir
  // ni à dépiler, son (projet, domaine) est déjà libre. Team absente : idem, on
  // ne fabrique aucune action sur une donnée qui n'existe pas.
  if (team === null || team.etat === 'demantelee') return { type: 'hors_team' };

  // 1. La team survit : `active` → `dormante`. Gardé par l'état pour ne jamais
  // lever sur une team déjà endormie (double notification de fin, par exemple).
  if (team.etat === 'active') deps.registre.teams.endormir(teamId, maintenant);

  // 2. Conservation du worktree en veille (action PC, best-effort).
  try {
    await deps.conserverWorktreeTeam(missionId);
  } catch (erreur) {
    log.error(
      { err: erreur, teamId, missionId },
      'conservation du worktree en veille en échec — la team est endormie côté Pi malgré tout',
    );
  }

  // 3. Dépilage de la file (B2).
  const feature = deps.registre.featureQueue.premiereEnAttente(team.projet, team.domaine);
  if (feature === null) return { type: 'endormie', teamId };

  // `☠` D4 : le dépilage n'est AUTOMATIQUE que sous fenêtre d'autonomie. Hors
  // fenêtre, la feature reste `en_attente` — elle démarrera au prochain clic
  // humain (H-61), jamais toute seule.
  if (!deps.fenetreAutonomieActive(mission.conversationId)) {
    return { type: 'file_attente', teamId, featureId: feature.id };
  }

  // `☠` `assigner` GARDE la transition (`WHERE etat = 'en_attente'`) : si un autre
  // dépilage a déjà pris cette feature, on ne la double pas — on la laisse à lui.
  if (!deps.registre.featureQueue.assigner(feature.id, teamId, maintenant)) {
    return { type: 'endormie', teamId };
  }

  const proposition = feature.propositionId === null ? null : deps.registre.propositions.lire(feature.propositionId);
  if (proposition === null) {
    // Mandat purgé/illisible : on ANNULE l'entrée de file plutôt que de boucler
    // dessus indéfiniment. La team reste dormante, réveillable par ailleurs.
    deps.registre.featureQueue.marquer(feature.id, 'annulee');
    log.warn({ featureId: feature.id, teamId }, 'feature dépilée sans proposition relisible — annulée');
    return { type: 'endormie', teamId };
  }

  try {
    const resultat = await deps.redispatcher(proposition);
    // `☠` Le re-dispatch réveille la team dormante (worktree réutilisé) et démarre.
    // S'il n'a rien démarré (remis en file parce que la team s'est retrouvée
    // occupée entre-temps, ou dispatch en échec sans exception), on REND la feature
    // à la file plutôt que de la laisser `assignee` fantôme.
    if (resultat.missionId === null) {
      deps.registre.featureQueue.remettreEnAttente(feature.id);
      return { type: 'file_attente', teamId, featureId: feature.id };
    }
    deps.registre.featureQueue.marquer(feature.id, 'en_cours');
    return { type: 'depilee', teamId, featureId: feature.id, resultat };
  } catch (erreur) {
    // Re-dispatch en échec : la feature retourne en file, dépilable au prochain
    // réveil ou clic. Ne jamais la perdre sur un échec de démarrage.
    deps.registre.featureQueue.remettreEnAttente(feature.id);
    log.error(
      { err: erreur, featureId: feature.id, teamId },
      're-dispatch de la feature dépilée en échec — feature remise en file',
    );
    return { type: 'file_attente', teamId, featureId: feature.id };
  }
}
