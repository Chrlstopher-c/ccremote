// Responsabilité : les routes de l'Agent HQ (interface Vite + Phaser) servies sous /hq/. Publiques comme l'ancienne
// interface : l'app ne contient aucun secret et doit pouvoir afficher son écran de connexion ; l'API reste protégée.
import { erreur } from './http.ts';
import { indexSpa, servirStatique } from './statique.ts';

export const PREFIXE_HQ = '/hq';
type Gestionnaire = (req: Request) => Response;

export function routesHq(racine: string): Record<string, Gestionnaire> {
  const gestionnaire: Gestionnaire = (req) => fichierHq(racine, req);
  return { [PREFIXE_HQ]: gestionnaire, [`${PREFIXE_HQ}/*`]: gestionnaire };
}

function fichierHq(racine: string, req: Request): Response {
  const chemin = new URL(req.url).pathname.slice(PREFIXE_HQ.length) || '/';
  const fichier = servirStatique(racine, chemin);
  if (fichier) return fichier;
  // Une adresse avec extension absente est un script ou une image manquant : 404, jamais du HTML à la place.
  if (/\.[a-z0-9]+$/i.test(chemin)) return erreur('introuvable', 404);
  return indexSpa(racine);
}
