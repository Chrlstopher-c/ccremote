// Responsabilité : la route `GET /api/maj/:fichier` du nœud, par laquelle l'appli de cette machine cherche ses mises à
// jour sans jeton GitHub. Le nœud les lit à son aiguilleur avec son jeton de membre ; dans le manifeste, les adresses
// des paquets sont réécrites vers cette même route, pour que l'appli télécharge aussi par son nœud.
import type { Logger } from 'pino';
import type { SecretsNoeud } from './secrets.ts';

const DELAI_MANIFESTE_MS = 15_000;
const DELAI_PAQUET_MS = 15 * 60_000;
const NOM_PERMIS = /^(latest\.json|[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(AppImage|exe|msi|sig|tar\.gz|zip))$/;

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

/** Le manifeste dont chaque `url` de plateforme pointe vers `base`/api/maj/<nom du paquet>. */
export function manifesteReecrit(brut: unknown, base: string): unknown {
  if (typeof brut !== 'object' || brut === null) return brut;
  const manifeste = brut as { platforms?: Record<string, { url?: unknown }> }; // forme Tauri, lue champ à champ
  for (const plateforme of Object.values(manifeste.platforms ?? {})) {
    if (typeof plateforme.url !== 'string') continue;
    const nom = plateforme.url.split('/').pop() ?? '';
    if (NOM_PERMIS.test(nom)) plateforme.url = `${base}/api/maj/${encodeURIComponent(nom)}`;
  }
  return manifeste;
}

export function routesMisesAJour(secrets: SecretsNoeud, journal: Logger, protege: Protection) {
  return {
    '/api/maj/:fichier': {
      GET: protege(async (req) => {
        const nom = req.params['fichier'] ?? '';
        if (!NOM_PERMIS.test(nom)) return new Response('introuvable', { status: 404 });
        const config = secrets.lireAiguilleur();
        if (!config) return new Response('pas d’aiguilleur : pas de mises à jour par le réseau', { status: 404 });
        try {
          const manifeste = nom === 'latest.json';
          const rep = await fetch(new URL(`/maj/${encodeURIComponent(nom)}`, config.url), {
            headers: { authorization: `Bearer ${config.jeton}` },
            signal: AbortSignal.timeout(manifeste ? DELAI_MANIFESTE_MS : DELAI_PAQUET_MS),
          });
          if (!rep.ok) return new Response(rep.statusText, { status: rep.status });
          if (!manifeste) return new Response(rep.body, { headers: { 'content-type': 'application/octet-stream' } });
          const base = new URL(req.url).origin;
          return Response.json(manifesteReecrit(await rep.json(), base));
        } catch (erreur) {
          journal.warn({ err: erreur, nom }, 'mise à jour : aiguilleur injoignable');
          return new Response('aiguilleur injoignable', { status: 502 });
        }
      }),
    },
  };
}
