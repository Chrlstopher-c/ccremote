// Responsabilité : le verdict pur d'une requête Claude relayée par un invité — membre et machine, chemin, part, modèle
// et effort permis, sessions simultanées. Aucune E/S : le serveur du relais fournit l'état et applique le verdict.
import { z } from 'zod';
import { effortApplique, type ReglagesInvite, type VerdictPart } from '../../commun/invites.ts';
import { EffortSession } from '../../commun/session.ts';
import { cheminPermis, type TypeErreurClaude } from '../../commun/relais-claude.ts';

export interface EntreeVerdictClaude {
  readonly reglages: ReglagesInvite | null; // null : le membre n'est pas invité dans la charte de ce nœud
  readonly moi: string | null; // ce nœud dans la charte
  readonly methode: 'GET' | 'POST' | 'HEAD';
  readonly chemin: string;
  readonly corps: string; // texte JSON de la requête
  readonly session: string; // x-claude-code-session-id (vide si absent)
  readonly sessionsRecentes: readonly string[]; // sessions Claude Code vues dans la fenêtre de simultanéité
  readonly part: VerdictPart; // part de la limite de 5 h et de la semaine, déjà calculée par le nœud
}

export type VerdictClaude =
  | { readonly ok: true; readonly modele: string; readonly effort: EffortSession | null }
  | { readonly ok: false; readonly statut: number; readonly type: TypeErreurClaude; readonly message: string };

type Refus = Extract<VerdictClaude, { ok: false }>;
type Effort =
  { readonly ok: true; readonly effort: EffortSession | null } | { readonly ok: false; readonly raison: string };

const CorpsModele = z.object({
  model: z.string().min(1).max(120),
  output_config: z.object({ effort: z.string().nullish() }).nullish(),
});
/** Identifiant de session retenu quand Claude Code n'en envoie pas (une seule session anonyme). */
export const SANS_SESSION = 'sans-session';

function refus(statut: number, type: TypeErreurClaude, message: string): Refus {
  return { ok: false, statut, type, message };
}

/** Le verdict d'une requête : membre, machine, chemin, part, puis le corps (modèle, effort) et les simultanées. */
export function verdictRequeteClaude(e: EntreeVerdictClaude): VerdictClaude {
  if (e.reglages === null) return refus(403, 'permission_error', 'compte non invité sur ce nœud');
  if (e.moi === null || !e.reglages.machines.includes(e.moi)) {
    return refus(403, 'permission_error', 'machine non permise pour cet invité');
  }
  if (e.methode !== 'POST' || !cheminPermis(e.chemin)) return refus(403, 'permission_error', 'chemin non permis');
  // Limites de l'invité : 403, pas 429. Claude Code réessaie un 429 en boucle sans rien montrer (23/11 : session
  // figée « 1min 57s » sans message) ; un 403 s'arrête et s'affiche dans le fil, avec ce texte.
  if (!e.part.ok) return refus(403, 'permission_error', `limite de ta part atteinte : ${e.part.raison}`);
  return verdictCorps(e.reglages, e.corps, e.session === '' ? SANS_SESSION : e.session, e.sessionsRecentes);
}

function verdictCorps(r: ReglagesInvite, corps: string, session: string, recentes: readonly string[]): VerdictClaude {
  const lu = lireCorps(corps);
  if (lu === null) return refus(400, 'invalid_request_error', 'corps JSON avec un modèle attendu');
  const effort = verdictEffort(r, lu.model, lu.output_config?.effort);
  if (!effort.ok) return refus(403, 'permission_error', effort.raison);
  if (!recentes.includes(session) && recentes.length >= r.simultanees) {
    return refus(
      403,
      'permission_error',
      `trop de conversations en cours en même temps (max ${r.simultanees}) : attends qu'une autre finisse ou ferme-la`,
    );
  }
  return { ok: true, modele: lu.model, effort: effort.effort };
}

function verdictEffort(r: ReglagesInvite, modele: string, demande: string | null | undefined): Effort {
  if (demande === undefined || demande === null) {
    const base = effortApplique(r, modele, null);
    return base.ok ? { ok: true, effort: null } : { ok: false, raison: base.raison };
  }
  const effort = EffortSession.safeParse(demande);
  if (!effort.success) return { ok: false, raison: `effort non permis : ${demande}` };
  const permis = effortApplique(r, modele, effort.data);
  return permis.ok ? { ok: true, effort: effort.data } : { ok: false, raison: permis.raison };
}

function lireCorps(texte: string): z.infer<typeof CorpsModele> | null {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  const lu = CorpsModele.safeParse(brut);
  return lu.success ? lu.data : null;
}
