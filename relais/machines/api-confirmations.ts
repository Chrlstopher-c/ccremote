// Responsabilité : les routes des confirmations — demander (outil), lire et répondre (appli de Chris), attendre (outil).
import { z } from 'zod';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { Confirmations } from './confirmations.ts';

type Requete = Request & { params: Record<string, string> };

const CorpsDemande = z.object({
  action: z.string().min(1).max(60),
  cible: z.string().min(1).max(120),
  resume: z.string().min(1).max(500),
});
const CorpsReponse = z.object({ accord: z.boolean() });

export class ApiConfirmations {
  constructor(private readonly confirmations: Confirmations) {}

  async demander(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsDemande);
    if (c instanceof Response) return c;
    return json(this.confirmations.demander(c), 201);
  }

  lire(req: Requete): Response {
    const c = this.confirmations.lire(req.params['id'] ?? '');
    return c ? json(c) : erreur('confirmation inconnue', 404);
  }

  async attendre(req: Requete): Promise<Response> {
    const secondes = Math.min(Math.max(Number(new URL(req.url).searchParams.get('attendre') ?? 25), 0), 30);
    const c = await this.confirmations.attendre(req.params['id'] ?? '', secondes * 1000);
    return c ? json(c) : erreur('confirmation inconnue', 404);
  }

  async repondre(req: Requete): Promise<Response> {
    const corps = await lireCorps(req, CorpsReponse);
    if (corps instanceof Response) return corps;
    const r = this.confirmations.repondre(req.params['id'] ?? '', corps.accord);
    return r.ok ? json(r.confirmation) : erreur(r.erreur, 409);
  }
}
