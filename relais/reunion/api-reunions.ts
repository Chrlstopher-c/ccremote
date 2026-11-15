// Responsabilité : les routes de la salle de réunion (HQ) — créer ou poursuivre une réunion, lire la liste et une
// réunion. Chaque route journalise son échec : une exception avalée ne doit jamais disparaître en silence.
import type { Logger } from 'pino';
import { DemandeReunion } from '../../commun/reunion.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { SalleDeReunion } from './salle.ts';

type Requete = Request & { params: Record<string, string> };
type Gestionnaire = (req: Requete) => Response | Promise<Response>;
export type Protege = (g: Gestionnaire) => Gestionnaire;

export interface DependancesReunions {
  readonly salle: SalleDeReunion;
  readonly journal: Logger;
}

export function routesReunions(d: DependancesReunions, protege: Protege) {
  return {
    '/api/reunions': {
      GET: protege(() => securise(d.journal, 'lister', () => json(d.salle.lister()))),
      POST: protege((req) => securise(d.journal, 'demander', () => demander(d.salle, req))),
    },
    '/api/reunions/:id': {
      GET: protege((req) => securise(d.journal, 'ouvrir', () => ouvrir(d.salle, req.params['id'] ?? ''))),
    },
  };
}

async function demander(salle: SalleDeReunion, req: Request): Promise<Response> {
  const corps = await lireCorps(req, DemandeReunion);
  if (corps instanceof Response) return corps;
  const r = await salle.demander(corps);
  return r.ok ? json(r.valeur, 201) : erreur(r.erreur, r.statut);
}

function ouvrir(salle: SalleDeReunion, id: string): Response {
  const reunion = salle.ouvrir(id);
  return reunion ? json(reunion) : erreur('réunion inconnue', 404);
}

async function securise(
  journal: Logger,
  action: string,
  operation: () => Response | Promise<Response>,
): Promise<Response> {
  try {
    return await operation();
  } catch (err) {
    journal.error({ err, action }, 'route de réunion en échec');
    return erreur('erreur interne de la salle de réunion', 500);
  }
}
