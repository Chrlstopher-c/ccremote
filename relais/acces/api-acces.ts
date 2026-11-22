// Responsabilité : les routes de gestion des accès — lister, créer un connecteur Claude, révoquer.
// Réservées aux appareils connectés par mot de passe ou appairés : un connecteur Claude (URL MCP) ne peut ni émettre ni
// révoquer d'accès.
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Acces } from './acces.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import { type Gestionnaire, type PosteRelais, reserveAppareil, routesAppairage } from './api-appairage.ts';

const CorpsAcces = z.object({
  nom: z.string().trim().min(1).max(80),
  genre: z.enum(['claude-code', 'claude-ai']),
  jours: z.number().int().min(1).max(3650),
});

export function routesAcces(
  acces: Acces,
  journal: Logger,
  poste: PosteRelais | null = null,
): Record<string, Record<string, Gestionnaire>> {
  const reserve = reserveAppareil(acces);
  return {
    ...routesAppairage(acces, journal, poste),
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
