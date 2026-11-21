// Responsabilité : la route `POST /api/modules/<id>/serveur` — une requête HTTP relayée au serveur du module, sur le
// poste de sa machine ; la réponse du serveur (statut, en-têtes, corps) revient telle quelle. Serveur absent, en panne
// ou injoignable : 503 avec la raison, dans la forme `{ status, headers, body, encodage, erreur }`.
import { depasseCorpsServeur, RequeteServeur, ReponseServeur } from '../../commun/modules.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';

export async function requeteServeurModule(
  registre: Registre,
  postes: Pick<Postes, 'commander'>,
  id: string,
  req: Request,
): Promise<Response> {
  const module = registre.modules.obtenir(id);
  if (module === null) return erreur('module inconnu', 404);
  if (module.erreur !== null) return indisponible('module en erreur');
  const declare = module.manifeste?.serveur;
  if (declare === undefined) return indisponible('ce module n’a pas de serveur');
  const demande = await lireCorps(req, RequeteServeur);
  if (demande instanceof Response) return demande;
  if (depasseCorpsServeur(demande.body, demande.encodage)) return erreur('corps trop volumineux (4 Mo au plus)', 413);
  const machine = declare.machine ?? module.machine;
  const r = await postes.commander(machine, { kind: 'module_requete', module: id, requete: demande });
  if (!r.ok) return indisponible(r.erreur ?? 'serveur indisponible');
  const reponse = ReponseServeur.safeParse(r.donnees);
  return reponse.success ? json(reponse.data) : indisponible('réponse du poste illisible');
}

function indisponible(raison: string): Response {
  const corps = { status: 503, headers: {}, body: '', encodage: 'texte', erreur: raison };
  return json(corps, 503);
}
