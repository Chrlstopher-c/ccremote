// Responsabilité : les routes des comptes Claude Code d'une machine — connexion OAuth en deux temps, retrait, relevé.
// Le relais ne voit jamais d'identifiant : l'URL d'autorisation et le code transitent, le jeton reste sur la machine.
import type { Logger } from 'pino';
import { z } from 'zod';
import { NOM_COMPTE } from '../../commun/comptes.ts';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import type { Postes } from '../parc/postes.ts';
import { erreur, json, lireCorps } from './http.ts';

type SansId<T> = T extends unknown ? Omit<T, 'id'> : never;
type RequeteCompte = Request & { params: { id: string; nom?: string } };

const CorpsConnexion = z.object({ nom: z.string().regex(NOM_COMPTE, 'minuscules, chiffres et tirets seulement') });
const CorpsCode = z.object({ code: z.string().trim().min(1).max(2000) });

export class ApiComptes {
  constructor(
    private readonly postes: Postes,
    private readonly journal: Logger,
  ) {}

  async connecter(req: RequeteCompte): Promise<Response> {
    const c = await lireCorps(req, CorpsConnexion);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'compte_connecter', nom: c.nom });
  }

  async code(req: RequeteCompte): Promise<Response> {
    const c = await lireCorps(req, CorpsCode);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'compte_code', nom: req.params.nom ?? '', code: c.code });
  }

  retirer(req: RequeteCompte): Promise<Response> {
    return this.commander(req.params.id, { kind: 'compte_retirer', nom: req.params.nom ?? '' });
  }

  relever(req: RequeteCompte): Promise<Response> {
    return this.commander(req.params.id, { kind: 'comptes_relever' });
  }

  private async commander(machine: string, c: SansId<CommandeRelais>): Promise<Response> {
    const r = await this.postes.commander(machine, c);
    if (!r.ok) this.journal.warn({ machine, commande: c.kind, erreur: r.erreur }, 'commande de compte refusée');
    return r.ok ? json(r.donnees ?? { ok: true }) : erreur(r.erreur ?? 'refusé', 502);
  }
}
