// Responsabilité : les réglages qu'on change en cours de session SDK (mode de permission, modèle, effort, titre) — leur
// application à la requête vivante et leur effet sur l'état de la session. Pur hors de l'appel à la requête.
import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { DemandeSession, ResumeSession } from '../../commun/session.ts';
import type { Reglage, SessionPoste } from './session-poste.ts';

export const MODELE_PAR_DEFAUT = 'défaut';

// Ce que la requête vivante accepte en cours de route (le SDK les expose sur son objet `Query`).
export interface RequeteReglable {
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: {
    readonly effortLevel?: EffortLevel | null;
    readonly outputStyle?: string | null;
  }): Promise<void>;
}

export async function appliquerReglage(requete: RequeteReglable, r: Reglage): Promise<void> {
  if (r.kind === 'mode') return requete.setPermissionMode(r.mode);
  if (r.kind === 'modele') return requete.setModel(r.modele === MODELE_PAR_DEFAUT ? undefined : r.modele);
  if (r.kind === 'effort') return requete.applyFlagSettings({ effortLevel: r.effort });
  if (r.kind === 'style') return requete.applyFlagSettings({ outputStyle: r.style });
  return undefined;
}

/** Les champs de l'état qu'un réglage change (le renommage ne touche qu'au titre). */
export function champsReglage(r: Reglage): Partial<ResumeSession> {
  if (r.kind === 'mode') return { mode: r.mode };
  if (r.kind === 'modele') return { modele: r.modele };
  if (r.kind === 'effort') return { effort: r.effort };
  if (r.kind === 'style') return { style_sortie: r.style };
  return { titre: r.titre };
}

// Mode et modèle voulus à l'ouverture s'appliquent avant le premier message (SDK seulement) ; rend le refus éventuel.
export async function reglagesDeOuverture(session: SessionPoste, d: DemandeSession): Promise<string | null> {
  if ((d.moteur ?? 'sdk') !== 'sdk') return null;
  const reglages: Reglage[] = [];
  if (d.mode && d.mode !== 'bypassPermissions') reglages.push({ kind: 'mode', mode: d.mode });
  if (d.modele) reglages.push({ kind: 'modele', modele: d.modele });
  for (const reglage of reglages) {
    const refus = await session.reglerSession(reglage);
    if (refus) return refus;
  }
  return null;
}
