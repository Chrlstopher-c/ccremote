/**
 * Responsabilité : classer comment une mission s'est terminée (C-2, SPEC §5), à partir
 * de faits déjà persistés dans le registre — sans modèle, gratuit.
 *
 * `☠` Frontière A↔B stricte (`harness/ARCHITECTURE.md`) : ce fichier n'importe RIEN de
 * `control-plane/registre/`. Le domaine définit son propre type d'entrée, minimal ; la
 * composition (hors périmètre de ce mandat) copie les champs de `Mission` dans cette forme.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { IssueMission } from '../types.ts';

/** Sous-ensemble de `EtatHarness` (`control-plane/registre/types.ts`) — copié, jamais importé. */
export type EtatHarnessMission =
  | 'planifiee'
  | 'en_cours'
  | 'en_pause'
  | 'attente_machine'
  | 'echec_definitif'
  | 'terminee'
  | 'annulee';

/** Sous-ensemble de `VerdictInspection` (`control-plane/inspection/etat-inspection.ts`). */
export type VerdictInspectionMission = 'progres' | 'incertain' | 'boucle' | null;

/**
 * `☠` `null` signifie « jamais mesuré », JAMAIS « propre » (`registre/types.ts`, migration 23).
 * Une équipe qui rend la main avec du travail non commité serait sinon présentée comme ayant
 * livré.
 */
export interface ConstatGitMission {
  readonly fichiersModifies: number;
  readonly dernierCommit: string | null;
}

/**
 * Objet plat, copié depuis `Mission` — jamais le type `Mission` lui-même (frontière A↔B).
 * Chaque champ correspond à un signal gratuit déjà persisté (SPEC §2 F-6).
 */
export interface DonneesMissionTerminee {
  readonly etatHarness: EtatHarnessMission;
  readonly derniereRaisonTerminale: string | null;
  readonly constatGit: ConstatGitMission | null;
  readonly compteurRelances: number;
  readonly inspection: { readonly verdict: VerdictInspectionMission };
  readonly budgetConsommeUsd: number;
  readonly budgetMaxUsd: number | null;
  /**
   * Porté pour observabilité future (proximité de la limite de contexte) — aucun seuil
   * `contexteTokensMax` n'est fourni par ce contrat minimal, donc ce champ n'entre dans
   * aucune branche de décision de la v1. Le retirer romprait néanmoins le contrat attendu
   * par `PLAN-PORTAGE.md` (E3, liste des champs copiés depuis `Mission`).
   */
  readonly contexteTokensUtilises: number | null;
}

/**
 * Signal F-6 : « une mission a fini … après quatre relances » est un motif d'échec gratuit,
 * au même titre que zéro fichier modifié. Valeur reprise du texte de la spec, pas mesurée.
 */
const SEUIL_RELANCES_ECHEC = 4;

function budgetEpuise(mission: DonneesMissionTerminee): boolean {
  return mission.budgetMaxUsd !== null && mission.budgetConsommeUsd >= mission.budgetMaxUsd;
}

/**
 * Travail réel mais jamais mis à l'abri : des fichiers sont modifiés, aucun commit ne les
 * couvre. C'est exactement la distinction que `registre/types.ts` (migration 23) introduit —
 * « a fini de parler » n'est pas « a livré ».
 */
function livreePartiellement(constatGit: ConstatGitMission): boolean {
  return constatGit.fichiersModifies > 0 && constatGit.dernierCommit === null;
}

/**
 * Classe l'issue d'une mission terminée, sans modèle. Fonction pure, aucune I/O.
 *
 * Ordre de priorité, documenté ici parce que la spec ne donne pas d'algorithme littéral :
 *  1. `constatGit === null` ⇒ `inconnue` — priorité absolue (SPEC §5 C-2 `☠`, le piège capital :
 *     jamais mesuré ne doit jamais se lire comme propre) ;
 *  2. verdict d'inspection `boucle` ⇒ `boucle` — signal mesuré, indépendant de la décision
 *     opérateur (`confirme`/`decline` ne change pas ce qui s'est produit) ;
 *  3. `annulee` ⇒ `interrompue` — arrêt qui n'est ni un succès ni un échec technique ;
 *  4. budget consommé ≥ budget max ⇒ `budget_epuise` ;
 *  5. relances ≥ seuil (F-6) ou `echec_definitif` ⇒ `echec_technique` ;
 *  6. zéro fichier modifié ⇒ `sans_effet` ;
 *  7. fichiers modifiés sans commit ⇒ `livree_partielle` ;
 *  8. sinon ⇒ `livree`.
 */
export function classerIssue(mission: DonneesMissionTerminee): IssueMission {
  if (mission.constatGit === null) return 'inconnue';
  if (mission.inspection.verdict === 'boucle') return 'boucle';
  if (mission.etatHarness === 'annulee') return 'interrompue';
  if (budgetEpuise(mission)) return 'budget_epuise';
  if (mission.etatHarness === 'echec_definitif' || mission.compteurRelances >= SEUIL_RELANCES_ECHEC) {
    return 'echec_technique';
  }
  if (mission.constatGit.fichiersModifies === 0) return 'sans_effet';
  if (livreePartiellement(mission.constatGit)) return 'livree_partielle';
  return 'livree';
}
