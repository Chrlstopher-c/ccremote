// Responsabilité : les routes de gestion des accès — lister, créer un connecteur Claude, révoquer. Réservées aux
// appareils connectés par mot de passe : un connecteur Claude (URL MCP) ne peut ni émettre ni révoquer d'accès.
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Acces } from './acces.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';

const CorpsAcces = z.object({
  nom: z.string().trim().min(1).max(80),
  genre: z.enum(['claude-code', 'claude-ai']),
  jours: z.number().int().min(1).max(3650),
});

type Gestionnaire = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;

export function routesAcces(acces: Acces, journal: Logger): Record<string, Record<string, Gestionnaire>> {
  const reserve =
    (g: Gestionnaire): Gestionnaire =>
    (req) => {
      const genre = acces.genre(req);
      if (genre === null) return erreur('non connecté', 401);
      return genre === 'appareil' ? g(req) : erreur('réservé aux appareils connectés par mot de passe', 403);
    };
  return {
    '/api/acces': {
      GET: reserve((req) => json(acces.lister(req))),
      POST: reserve(async (req) => {
        const c = await lireCorps(req, CorpsAcces);
        if (c instanceof Response) return c;
        const nouvel = acces.emettre(c);
        journal.info({ id: nouvel.id, genre: c.genre, nom: c.nom }, 'accès émis');
        return json(nouvel, 201);
      }),
    },
    '/api/acces/:id/revoquer': {
      POST: reserve((req) => {
        const id = req.params['id'] ?? '';
        if (!acces.revoquer(id)) return erreur('accès inconnu', 404);
        journal.info({ id }, 'accès révoqué');
        return json({ ok: true });
      }),
    },
  };
}
