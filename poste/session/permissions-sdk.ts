// Responsabilité : les demandes de permission d'un outil (sessions hors mode bypass) — leur dialogue pour Chris, et la
// décision rendue au SDK selon son choix. Pur, sans I/O.
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { Dialogue, ReponseDialogue } from '../../commun/session.ts';

export const TAILLE_ENTREE = 2_000;
const TEXTE_REFUS = 'Refusé par l’utilisateur';

// Ordre fixe : l'index de la réponse de Chris désigne l'option (0, 1 ou 2).
export const OPTIONS_PERMISSION = [
  { libelle: 'Autoriser', description: 'Cette fois seulement' },
  { libelle: 'Toujours autoriser', description: 'Pour la suite de la session, si le SDK propose une règle' },
  { libelle: 'Refuser', description: 'Claude doit trouver autre chose' },
] as const;

export function texteEntree(entree: Record<string, unknown>): string {
  const texte = JSON.stringify(entree, null, 1) ?? '';
  return texte.length > TAILLE_ENTREE ? `${texte.slice(0, TAILLE_ENTREE)}…` : texte;
}

export function dialoguePermission(
  id: string,
  outil: string,
  entree: Record<string, unknown>,
  suggestions: readonly PermissionUpdate[],
): Dialogue {
  return {
    id,
    titre: `Autoriser ${outil} ?`,
    options: OPTIONS_PERMISSION.map((o) => ({ libelle: o.libelle, description: o.description })),
    multiple: false,
    saisie: null,
    coches: [],
    permission: { outil, entree: texteEntree(entree), suggestion: suggestions.length > 0 },
  };
}

/** La décision à rendre au SDK pour une permission, ou null si l'index ne désigne aucune option. */
export function decisionPermission(
  entree: Record<string, unknown>,
  suggestions: readonly PermissionUpdate[],
  r: ReponseDialogue,
): PermissionResult | null {
  if (r.index === 0) return { behavior: 'allow', updatedInput: entree };
  if (r.index === 1) return { behavior: 'allow', updatedInput: entree, updatedPermissions: [...suggestions] };
  if (r.index === 2) return { behavior: 'deny', message: TEXTE_REFUS };
  return null;
}
