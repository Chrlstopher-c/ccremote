// Responsabilité : les routes Echo des clients — parler, interrompre, relire l'historique, savoir si Echo répond.
import { z } from 'zod';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { LienEcho } from './lien-echo.ts';

type Gestionnaire = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;

const CorpsParler = z.object({ texte: z.string().min(1).max(20_000), appareil: z.string().max(60).optional() });
const CorpsReglage = z.object({ micro: z.boolean().optional(), voix: z.boolean().optional() });
const CorpsVoix = z.object({ action: z.enum(['enroler', 'oublier', 'annuler']) });
const CorpsRetrait = z.object({ id: z.string().min(1).max(60) });
const INJOIGNABLE = 'Echo injoignable';
const fait = (ok: boolean): Response => (ok ? json({ ok: true }) : erreur(INJOIGNABLE, 502));

type Protege = (g: Gestionnaire) => Gestionnaire;
type Avec = (f: (lien: LienEcho, req: Request) => Response | Promise<Response>) => Gestionnaire;

function routesLecture(protege: Protege, avec: Avec) {
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
  };
}

function routesAction(protege: Protege, avec: Avec) {
  const poster = <T>(schema: z.ZodType<T>, f: (lien: LienEcho, c: T) => boolean) => ({
    POST: protege(
      avec(async (lien, req) => {
        const c = await lireCorps(req, schema);
        return c instanceof Response ? c : fait(f(lien, c));
      }),
    ),
  });
  return {
    '/api/echo/parler': poster(CorpsParler, (lien, c) => lien.parler(c.texte, `quart:${c.appareil ?? 'app'}`)),
    '/api/echo/reglage': poster(CorpsReglage, (lien, c) => lien.regler(c)),
    '/api/echo/voix': poster(CorpsVoix, (lien, c) => lien.commanderVoix(c.action)),
    '/api/echo/retirer': poster(CorpsRetrait, (lien, c) => lien.retirerCadre(c.id)),
    '/api/echo/interrompre': { POST: protege(avec((lien) => fait(lien.interrompre()))) },
  };
}

/** Sans Echo configurée, les routes existent et répondent 404 : l'app l'indique dans la vue. */
export function routesEcho(echo: LienEcho | null, protege: Protege) {
  const avec: Avec = (f) => (req) => (echo ? f(echo, req) : erreur('Echo non configurée', 404));
  return { ...routesLecture(protege, avec), ...routesAction(protege, avec) };
}
