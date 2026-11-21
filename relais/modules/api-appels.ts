// Responsabilité : les routes des appels de modules — `GET /api/modules-outils` pour les agents (outils et
// intégrations), `POST /api/modules-appels` (un agent appelle un outil, la réponse attend l'appli),
// `POST /api/modules-reponses` (une appli répond). Toutes protégées comme les autres routes du relais.
import { DemandeAppelModule, ReponseAppelModule } from '../../commun/modules.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { AppelsModules } from './appels.ts';

export function lireCapacites(appels: AppelsModules): Response {
  return json(appels.capacites());
}

export async function appelerModule(appels: AppelsModules, req: Request): Promise<Response> {
  const demande = await lireCorps(req, DemandeAppelModule);
  if (demande instanceof Response) return demande;
  const r = await appels.appeler(demande);
  return r.ok ? json({ resultat: r.resultat }) : erreur(r.erreur, REFUS_POSTE);
}

export async function repondreModule(appels: AppelsModules, req: Request): Promise<Response> {
  const reponse = await lireCorps(req, ReponseAppelModule);
  if (reponse instanceof Response) return reponse;
  return appels.repondre(reponse) ? json({ ok: true }) : erreur('appel inconnu ou déjà réglé', 404);
}
