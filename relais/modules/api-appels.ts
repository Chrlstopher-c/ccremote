// Responsabilité : les appels de modules, une seule logique pour deux chemins — les routes HTTP (`GET /api/modules-outils`,
// `POST /api/modules-appels`, `POST /api/modules-reponses`) et les requêtes du poste par le lien (`requete_relais`,
// voir postes.ts). Toutes protégées comme les autres routes du relais. L'appel qu'un pair relaie arrive par
// `appelerLocalPair` : les applis de ce nœud seulement, sans nouveau relais.
import { DemandeAppelModule, type QuoiRelais, ReponseAppelModule, type ReponseRelais } from '../../commun/modules.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { AppelsModules } from './appels.ts';

/** Les capacités des modules sains : la liste que lit `GET /api/modules-outils`. */
export function capacitesModules(appels: AppelsModules): ReponseRelais {
  return { ok: true, donnees: appels.capacites() };
}

/** Un appel d'outil relayé à une appli ; `donnees` est le corps de `POST /api/modules-appels` en succès. */
export async function appelerOutil(appels: AppelsModules, demande: DemandeAppelModule): Promise<ReponseRelais> {
  const r = await appels.appeler(demande);
  return r.ok ? { ok: true, donnees: { resultat: r.resultat } } : { ok: false, erreur: r.erreur };
}

/** Une requête du poste par le lien : la même logique que les routes, sans HTTP. */
export async function traiterRequeteRelais(
  appels: AppelsModules,
  quoi: QuoiRelais,
  args: unknown,
): Promise<ReponseRelais> {
  if (quoi === 'modules_lister') return capacitesModules(appels);
  const demande = DemandeAppelModule.safeParse(args);
  if (!demande.success) return { ok: false, erreur: 'arguments d’appel invalides' };
  return appelerOutil(appels, demande.data);
}

function sortie(r: ReponseRelais): Response {
  return r.ok ? json(r.donnees) : erreur(r.erreur ?? 'échec de l’outil', REFUS_POSTE);
}

export function lireCapacites(appels: AppelsModules): Response {
  return sortie(capacitesModules(appels));
}

export async function appelerModule(appels: AppelsModules, req: Request): Promise<Response> {
  const demande = await lireCorps(req, DemandeAppelModule);
  if (demande instanceof Response) return demande;
  return sortie(await appelerOutil(appels, demande));
}

/** Un appel relayé par un pair : la réponse est toujours 200 `{ ok, resultat }` ou `{ ok: false, erreur }`. */
export async function appelerLocalPair(appels: AppelsModules, req: Request): Promise<Response> {
  const demande = await lireCorps(req, DemandeAppelModule);
  if (demande instanceof Response) return demande;
  const r = await appels.appelerLocal(demande);
  return json(r.ok ? { ok: true, resultat: r.resultat ?? null } : { ok: false, erreur: r.erreur });
}

export async function repondreModule(appels: AppelsModules, req: Request): Promise<Response> {
  const reponse = await lireCorps(req, ReponseAppelModule);
  if (reponse instanceof Response) return reponse;
  return appels.repondre(reponse) ? json({ ok: true }) : erreur('appel inconnu ou déjà réglé', 404);
}
