// Responsabilité : la règle d'inactivité d'une session (pure) — tour fini et silence depuis le seuil.
import type { StatutSession } from '../../commun/session.ts';

export const SEUIL_INACTIVITE_MS = 30 * 60_000;

// Seuls ces statuts sont des tours finis : tout le reste travaille, attend Chris (question) ou n'a plus de tour.
const TOURS_FINIS: ReadonlySet<StatutSession> = new Set<StatutSession>(['attente', 'terminee']);

// L'ISO de la dernière activité (`majLe`) quand la session est inactive, null sinon. Sans date lisible : null.
export function inactiveDepuis(
  statut: StatutSession,
  majLe: string,
  maintenant: Date,
  seuilMs: number,
): string | null {
  if (!TOURS_FINIS.has(statut)) return null;
  const depuis = Date.parse(majLe);
  if (!Number.isFinite(depuis)) return null;
  return maintenant.getTime() - depuis >= seuilMs ? new Date(depuis).toISOString() : null;
}
