// Responsabilité : les routes Echo des clients — parler, interrompre, relire l'historique, savoir si Echo répond.
import { z } from 'zod';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { LienEcho } from './lien-echo.ts';

type Gestionnaire = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;

const CorpsParler = z.object({ texte: z.string().min(1).max(20_000), appareil: z.string().max(60).optional() });
const INJOIGNABLE = 'Echo injoignable';

/** Sans Echo configurée, les routes existent et répondent 404 : l'app masque alors la vue. */
export function routesEcho(echo: LienEcho | null, protege: (g: Gestionnaire) => Gestionnaire) {
  const avec =
    (f: (lien: LienEcho, req: Request) => Response | Promise<Response>): Gestionnaire =>
    (req) =>
      echo ? f(echo, req) : erreur('Echo non configurée', 404);
  return {
    '/api/echo/etat': { GET: protege(avec((lien) => json(lien.etat))) },
    '/api/echo/historique': {
      GET: protege(
        avec(async (lien, req) => {
          try {
            return json(await lien.historique(Number(new URL(req.url).searchParams.get('n') ?? 100)));
          } catch (err) {
            return erreur(String(err), 502);
          }
        }),
      ),
    },
    '/api/echo/parler': {
      POST: protege(
        avec(async (lien, req) => {
          const c = await lireCorps(req, CorpsParler);
          if (c instanceof Response) return c;
          return lien.parler(c.texte, `quart:${c.appareil ?? 'app'}`) ? json({ ok: true }) : erreur(INJOIGNABLE, 502);
        }),
      ),
    },
    '/api/echo/interrompre': {
      POST: protege(avec((lien) => (lien.interrompre() ? json({ ok: true }) : erreur(INJOIGNABLE, 502)))),
    },
  };
}
