// Responsabilité : les réglages qu'on change en cours de session SDK (mode de permission, modèle, effort, titre) — leur
// application à la requête vivante et leur effet sur l'état de la session. Pur hors de l'appel à la requête.
import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { ResumeSession } from '../../commun/session.ts';
import type { Reglage } from './session-poste.ts';

export const MODELE_PAR_DEFAUT = 'défaut';

// Ce que la requête vivante accepte en cours de route (le SDK les expose sur son objet `Query`).
export interface RequeteReglable {
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: { readonly effortLevel?: EffortLevel | null }): Promise<void>;
}

export async function appliquerReglage(requete: RequeteReglable, r: Reglage): Promise<void> {
  if (r.kind === 'mode') return requete.setPermissionMode(r.mode);
  if (r.kind === 'modele') return requete.setModel(r.modele === MODELE_PAR_DEFAUT ? undefined : r.modele);
  if (r.kind === 'effort') return requete.applyFlagSettings({ effortLevel: r.effort });
  return undefined;
}

/** Les champs de l'état qu'un réglage change (le renommage ne touche qu'au titre). */
export function champsReglage(r: Reglage): Partial<ResumeSession> {
  if (r.kind === 'mode') return { mode: r.mode };
  if (r.kind === 'modele') return { modele: r.modele };
  if (r.kind === 'effort') return { effort: r.effort };
  return { titre: r.titre };
}
