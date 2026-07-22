/**
 * Responsabilité : résoudre l'alias de modèle puis appliquer le plancher Sonnet
 * (B.1.2 étape 3, H-43).
 *
 * `☠ CASSE` — la validation porte sur le modèle **résolu**, jamais sur l'alias.
 * `'inherit'` n'est pas un modèle : il hérite du modèle principal et ne garantit
 * rien par lui-même (panne #20 de la grille de revue).
 */

import type { ModelTier, ResolvedModel } from './types.ts';

/** Rang par famille. Le plancher se compare sur ce rang, pas sur une chaîne. */
const TIER_RANK: Readonly<Record<ModelTier, number>> = {
  haiku: 1,
  sonnet: 2,
  opus: 3,
  fable: 3,
};

/** Plancher en vigueur (H-43). */
export const MODEL_FLOOR: ModelTier = 'sonnet';

/** Alias qui ne désignent aucun modèle : ils délèguent la décision ailleurs. */
const DEFERRING_ALIASES: readonly string[] = ['inherit', 'default', ''];

export class ModelResolutionError extends Error {
  constructor(
    message: string,
    readonly requested: string,
  ) {
    super(message);
    this.name = 'ModelResolutionError';
  }
}

export class ModelFloorError extends Error {
  constructor(
    readonly model: ResolvedModel,
  ) {
    super(
      `Modèle « ${model.resolved} » (famille ${model.tier}) sous le plancher ` +
        `${MODEL_FLOOR}. Demandé : « ${model.requested} »` +
        (model.viaInheritance ? ' (résolu par héritage)' : ''),
    );
    this.name = 'ModelFloorError';
  }
}

/**
 * Déduit la famille d'un identifiant ou alias de modèle.
 * Retourne `null` quand la famille est inconnue ou ambiguë — cas volontairement
 * refusé plus haut : un modèle non classable ne peut pas prouver le plancher.
 */
export function classifyModel(model: string): ModelTier | null {
  const needle = model.toLowerCase();
  const matches = (Object.keys(TIER_RANK) as ModelTier[]).filter((tier) => needle.includes(tier));
  const [only] = matches;
  return matches.length === 1 && only !== undefined ? only : null;
}

function isDeferring(model: string | undefined): boolean {
  return model === undefined || DEFERRING_ALIASES.includes(model.trim().toLowerCase());
}

/**
 * Résout le modèle demandé en un modèle concret.
 * `inherit` / `default` / absent ⇒ retombe sur le `model` effectif de la cascade
 * de settings du poste (pré-vol). Si celui-ci délègue à son tour, on échoue :
 * spawner sans savoir quel modèle tourne rendrait le plancher décoratif.
 */
export function resolveModel(requested: string | undefined, settingsModel: string | null): ResolvedModel {
  const viaInheritance = isDeferring(requested);
  const effective = viaInheritance ? settingsModel : (requested ?? null);
  const label = requested ?? 'inherit';

  if (effective === null || isDeferring(effective)) {
    throw new ModelResolutionError(
      `Impossible de résoudre le modèle « ${label} » : la cascade de settings ne fixe ` +
        `aucun modèle concret. Fixer WorkerSpec.model explicitement.`,
      label,
    );
  }

  const tier = classifyModel(effective);
  if (tier === null) {
    throw new ModelResolutionError(
      `Famille de modèle indéterminée pour « ${effective} » : le plancher ${MODEL_FLOOR} ` +
        `ne peut pas être prouvé. Fixer un alias ou un identifiant reconnaissable.`,
      label,
    );
  }

  return { requested: label, resolved: effective, tier, viaInheritance };
}

/** Applique le plancher sur le modèle **résolu**. Lève `ModelFloorError` sinon. */
export function assertModelFloor(model: ResolvedModel): ResolvedModel {
  const rank = TIER_RANK[model.tier];
  if (rank < TIER_RANK[MODEL_FLOOR]) {
    throw new ModelFloorError(model);
  }
  return model;
}

/** Résolution + plancher en une passe — le seul chemin utilisé au démarrage. */
export function resolveModelWithFloor(
  requested: string | undefined,
  settingsModel: string | null,
): ResolvedModel {
  return assertModelFloor(resolveModel(requested, settingsModel));
}
