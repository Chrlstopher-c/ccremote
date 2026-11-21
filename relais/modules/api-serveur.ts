// Responsabilité : la route `POST /api/modules/<id>/serveur` — une requête HTTP relayée au serveur du module, sur le
// poste de sa machine ; la réponse du serveur (statut, en-têtes, corps) revient telle quelle. Serveur absent, en panne
// ou injoignable : 503 avec la raison, dans la forme `{ status, headers, body, encodage, erreur }`. Un module reçu du
// pair (mode duo) n'a pas de poste chez nous : la requête passe par le lien, jusqu'au propriétaire.
import { estModuleDuo } from '../../commun/duo.ts';
import { depasseCorpsServeur, RequeteServeur, ReponseServeur } from '../../commun/modules.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import type { Resultat } from '../duo/resultat.ts';

// Ce que le mode duo offre pour un module reçu du pair : la requête part chez le propriétaire, la réponse revient.
export type RelaisServeur = (id: string, demande: RequeteServeur) => Promise<Resultat<ReponseServeur>>;

export async function requeteServeurModule(
  registre: Registre,
  postes: Pick<Postes, 'commander'>,
  id: string,
  req: Request,
  relais?: RelaisServeur,
): Promise<Response> {
  const demande = await lireCorps(req, RequeteServeur);
  if (demande instanceof Response) return demande;
  const r = await executerServeur(registre, postes, id, demande, relais);
  if (r.ok) return json(r.valeur);
  return r.statut === 503 ? indisponible(r.raison) : erreur(r.raison, r.statut);
}

/** La requête au serveur d'un module, faite par le poste de sa machine (ou par le propriétaire, pour un pair). */
export async function executerServeur(
  registre: Registre,
  postes: Pick<Postes, 'commander'>,
  id: string,
  demande: RequeteServeur,
  relais?: RelaisServeur,
): Promise<Resultat<ReponseServeur>> {
  const module = registre.modules.obtenir(id);
  if (module === null) return { ok: false, statut: 404, raison: 'module inconnu' };
  if (module.erreur !== null) return { ok: false, statut: 503, raison: 'module en erreur' };
  const declare = module.manifeste?.serveur;
  if (declare === undefined) return { ok: false, statut: 503, raison: 'ce module n’a pas de serveur' };
  if (depasseCorpsServeur(demande.body, demande.encodage)) {
    return { ok: false, statut: 413, raison: 'corps trop volumineux (4 Mo au plus)' };
  }
  if (estModuleDuo(module.machine)) return relais ? relais(id, demande) : indisponibleEn('module du pair');
  const machine = declare.machine ?? module.machine;
  const r = await postes.commander(machine, { kind: 'module_requete', module: id, requete: demande });
  if (!r.ok) return indisponibleEn(r.erreur ?? 'serveur indisponible');
  const reponse = ReponseServeur.safeParse(r.donnees);
  return reponse.success ? { ok: true, valeur: reponse.data } : indisponibleEn('réponse du poste illisible');
}

function indisponibleEn<T = never>(raison: string): Resultat<T> {
  return { ok: false, statut: 503, raison };
}

function indisponible(raison: string): Response {
  const corps = { status: 503, headers: {}, body: '', encodage: 'texte', erreur: raison };
  return json(corps, 503);
}
