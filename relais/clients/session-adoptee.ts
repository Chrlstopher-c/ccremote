// Responsabilité : la fiche d'une session avant une action de Chris. Une session connue du relais sert telle quelle ;
// une session seulement découverte sur un poste (transcript) est adoptée par le poste d'abord (fiche fermée, reprise
// SDK), puis son action part comme pour une session fermée.
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { erreur, REFUS_POSTE } from './http.ts';

export type SessionAdoptable = Pick<Postes, 'commander' | 'decouvertes'>;

export async function sessionAdoptee(
  registre: Registre,
  postes: SessionAdoptable,
  id: string,
): Promise<ResumeSession | Response> {
  const connue = registre.session(id);
  if (connue) return connue;
  const decouverte = postes.decouvertes(new Set()).find((d) => d.id === id);
  if (!decouverte) return erreur('session inconnue', 404);
  const r = await postes.commander(decouverte.machine, { kind: 'adopter', sessionId: id });
  if (!r.ok) return erreur(r.erreur ?? 'adoption refusée', REFUS_POSTE);
  return registre.session(id) ?? erreur('session pas encore reçue du poste : réessayer', 503);
}
