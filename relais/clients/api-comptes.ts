// Responsabilité : les routes des comptes Claude Code d'une machine — connexion OAuth en deux temps, retrait, relevé.
// Le relais ne voit jamais d'identifiant : l'URL d'autorisation et le code transitent, le jeton reste sur la machine.
import type { Logger } from 'pino';
import { z } from 'zod';
import { NOM_COMPTE } from '../../commun/comptes.ts';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import type { Postes } from '../parc/postes.ts';
import type { ReleveUsage } from '../usage/releves-usage.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';

type SansId<T> = T extends unknown ? Omit<T, 'id'> : never;
type RequeteCompte = Request & { params: { id: string; nom?: string } };

const CorpsConnexion = z.object({
  nom: z.string().regex(NOM_COMPTE, 'minuscules, chiffres et tirets seulement'),
  email: z.string().email().optional(),
});
const CorpsCode = z.object({ code: z.string().trim().min(1).max(2000) });
const CorpsReinitialisation = z.object({
  offre: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'identifiant d’offre invalide'),
});
const CorpsDistant = z.object({ actif: z.boolean() });

export class ApiComptes {
  constructor(
    private readonly postes: Postes,
    private readonly journal: Logger,
    private readonly usage: ReleveUsage,
  ) {}

  async connecter(req: RequeteCompte): Promise<Response> {
    const c = await lireCorps(req, CorpsConnexion);
    if (c instanceof Response) return c;
    const email = c.email ? { email: c.email } : {};
    return this.commander(req.params.id, { kind: 'compte_connecter', nom: c.nom, ...email });
  }

  async code(req: RequeteCompte): Promise<Response> {
    const c = await lireCorps(req, CorpsCode);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'compte_code', nom: req.params.nom ?? '', code: c.code });
  }

  retirer(req: RequeteCompte): Promise<Response> {
    return this.commander(req.params.id, { kind: 'compte_retirer', nom: req.params.nom ?? '' });
  }

  // L'usage vient du relais : il relève si le délai est écoulé, puis le poste reçoit la dernière valeur bonne.
  async detail(req: RequeteCompte): Promise<Response> {
    const nom = req.params.nom ?? '';
    if (!NOM_COMPTE.test(nom)) return erreur('nom de compte invalide', 400);
    const cle = this.usage.cleDe(req.params.id, nom);
    let fourni: ReturnType<ReleveUsage['brutPour']> | undefined;
    if (cle !== null) {
      await this.usage.releverSiDu(cle);
      fourni = this.usage.brutPour(cle);
    }
    return this.commander(req.params.id, { kind: 'compte_detail', nom, fourni });
  }

  async reinitialiser(req: RequeteCompte): Promise<Response> {
    if (!NOM_COMPTE.test(req.params.nom ?? '')) return erreur('nom de compte invalide', 400);
    const c = await lireCorps(req, CorpsReinitialisation);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'compte_reinitialiser', nom: req.params.nom ?? '', offre: c.offre });
  }

  async distant(req: RequeteCompte): Promise<Response> {
    if (!NOM_COMPTE.test(req.params.nom ?? '')) return erreur('nom de compte invalide', 400);
    const c = await lireCorps(req, CorpsDistant);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'compte_distant', nom: req.params.nom ?? '', actif: c.actif });
  }

  relever(req: RequeteCompte): Promise<Response> {
    void this.usage.tick();
    return this.commander(req.params.id, { kind: 'comptes_relever' });
  }

  private async commander(machine: string, c: SansId<CommandeRelais>): Promise<Response> {
    const r = await this.postes.commander(machine, c);
    if (!r.ok) this.journal.warn({ machine, commande: c.kind, erreur: r.erreur }, 'commande de compte refusée');
    return r.ok ? json(r.donnees ?? { ok: true }) : erreur(r.erreur ?? 'refusé', REFUS_POSTE);
  }
}
