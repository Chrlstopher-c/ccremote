/**
 * Responsabilité : enchaîner une passe d'apprentissage complète (C-2 → C-1 → C-3 → C-5) sur
 * une mission conclue, et enregistrer le résultat dans `passe_apprentissage` (SPEC §6).
 *
 * `☠` INVARIANT ABSOLU (PLAN-PORTAGE.md E6, SPEC §1/§6) : cette fonction NE LÈVE JAMAIS. Toute
 * panne — transcript illisible, modèle indisponible, base verrouillée — est capturée et
 * rendue comme un `ResultatPasseCloture.erreur` non nul, jamais comme une exception qui
 * remonterait jusqu'au superviseur et retarderait la clôture d'une mission (H-56 : une
 * mission qui ne se clôt pas verrouille son worktree, ce qui coûte infiniment plus que
 * l'apprentissage ne rapporte).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { enregistrerPasse, listerLeconsServables } from '../base/lecons.ts';
import type { ClientInference } from '../extraction/client-inference.ts';
import { extraireLecons } from '../extraction/extraction-lecons.ts';
import { rapprocherLecons } from '../extraction/rapprochement.ts';
import { classerIssue, type DonneesMissionTerminee } from '../observation/classement-issue.ts';
import { reduireTranscript } from '../observation/reduction-transcript.ts';
import { journal } from '../logger.ts';
import type { IssueMission } from '../types.ts';
import { resoudreCheminDepot } from './resolution-projet.ts';
import { cheminTranscriptMission } from './resolution-transcript.ts';

export interface EntreePasseCloture {
  readonly missionId: string;
  readonly sessionId: string;
  /** cwd RÉEL du worker à la clôture — un worktree dédié, le plus souvent (voir `resolution-projet.ts`). */
  readonly worktree: string;
  /** `CLAUDE_CONFIG_DIR` du compte qui a fait tourner cette mission — localise le transcript. */
  readonly configDir: string;
  readonly mandat: string | null;
  readonly critereArret: string | null;
  readonly donneesMission: DonneesMissionTerminee;
}

export interface ResultatPasseCloture {
  readonly issue: IssueMission;
  readonly leconsExtraites: number;
  /** Non `null` ⇒ passe en échec, l'entrée `passe_apprentissage` reste rejouable (SPEC §5.7 `☠`). */
  readonly erreur: string | null;
}

/** Enregistre la passe sans jamais laisser une panne d'écriture remonter (garde ultime). */
function enregistrerPasseSansRisque(
  db: Database,
  missionId: string,
  traiteeA: number,
  issue: IssueMission,
  leconsExtraites: number,
  erreur: string | null,
): void {
  try {
    enregistrerPasse(db, { missionId, traiteeA, issue, leconsExtraites, erreur });
  } catch (cause) {
    // `☠` Un second échec ici (ex. rejeu concurrent improbable, clé déjà prise) ne doit
    // JAMAIS remonter — c'est le dernier filet avant le superviseur (SPEC §1/§6).
    journal.error({ err: cause, missionId }, 'échec de l’enregistrement de la passe — non bloquant, journalisé seulement');
  }
}

/**
 * Exécute la passe complète pour une mission conclue. Ne lève jamais — toute panne rend un
 * `ResultatPasseCloture` avec `erreur` renseignée. L'appelant (`file-attente.ts`) garantit
 * l'unicité par mission ; cette fonction ne la revérifie pas.
 */
export async function executerPasseCloture(
  db: Database,
  client: ClientInference,
  entree: EntreePasseCloture,
  maintenant: number = Date.now(),
): Promise<ResultatPasseCloture> {
  let issue: IssueMission = 'inconnue';
  try {
    issue = classerIssue(entree.donneesMission);

    // Une mission jamais mesurée (`constatGit === null`) n'alimente aucune leçon (SPEC C-2 `☠`)
    // — on enregistre quand même la passe pour l'idempotence, sans jamais appeler le modèle.
    if (issue === 'inconnue') {
      enregistrerPasseSansRisque(db, entree.missionId, maintenant, issue, 0, null);
      return { issue, leconsExtraites: 0, erreur: null };
    }

    const projet = await resoudreCheminDepot(entree.worktree);
    const cheminTranscript = cheminTranscriptMission(entree.configDir, entree.worktree, entree.sessionId);

    const resume = await reduireTranscript({
      missionId: entree.missionId,
      projet,
      mandat: entree.mandat,
      critereArret: entree.critereArret,
      issue,
      cheminTranscript,
    });

    const leconsActives = listerLeconsServables(db, projet, null);
    const extraction = await extraireLecons(client, resume, leconsActives);
    if (extraction.erreur !== null) {
      enregistrerPasseSansRisque(db, entree.missionId, maintenant, issue, 0, extraction.erreur);
      return { issue, leconsExtraites: 0, erreur: extraction.erreur };
    }

    if (extraction.lecons.length > 0) {
      await rapprocherLecons({
        db,
        client,
        projet,
        missionId: entree.missionId,
        lecons: extraction.lecons,
        maintenant,
      });
    }

    enregistrerPasseSansRisque(db, entree.missionId, maintenant, issue, extraction.lecons.length, null);
    return { issue, leconsExtraites: extraction.lecons.length, erreur: null };
  } catch (cause) {
    const motif = cause instanceof Error ? cause.message : String(cause);
    journal.error({ err: cause, missionId: entree.missionId }, 'passe de clôture en échec — entrée rejouable, jamais bloquant');
    enregistrerPasseSansRisque(db, entree.missionId, maintenant, issue, 0, motif);
    return { issue, leconsExtraites: 0, erreur: motif };
  }
}
