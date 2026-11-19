// Responsabilité : les réglages d'une session qui passent par le poste (style de sortie, connecteurs MCP) et ses
// conversations annexes — liste lue au registre, création par le poste. Le relais ne décide rien de ces réglages.
import { z } from 'zod';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';

const CorpsStyle = z.object({ style: z.string().min(1).max(80).nullable() });
const CorpsConnecteur = z.object({ actif: z.boolean() });

type Requete = Request & { params: { id: string; nom?: string } };
type CommandeDeSession =
  | { readonly kind: 'style'; readonly style: string | null }
  | { readonly kind: 'styles' }
  | { readonly kind: 'connecteur'; readonly nom: string; readonly actif: boolean };

export class ApiSessionConfig {
  constructor(
    private readonly registre: Registre,
    private readonly postes: Pick<Postes, 'commander'>,
  ) {}

  async style(req: Requete): Promise<Response> {
    const c = await lireCorps(req, CorpsStyle);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'style', style: c.style });
  }

  styles(req: Requete): Promise<Response> {
    return this.commander(req.params.id, { kind: 'styles' });
  }

  async connecteur(req: Requete): Promise<Response> {
    const c = await lireCorps(req, CorpsConnecteur);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'connecteur', nom: nomDecode(req.params.nom ?? ''), actif: c.actif });
  }

  annexes(req: Requete): Response {
    const id = req.params.id;
    if (!this.registre.session(id)) return erreur('session inconnue', 404);
    const liste = this.registre
      .sessions(true)
      .filter((s) => s.annexe_de === id)
      .sort((a, b) => a.creeLe.localeCompare(b.creeLe))
      .map((s) => ({ id: s.id, titre: s.titre, cree_le: s.creeLe }));
    return json(liste);
  }

  // Une annexe n'a pas d'annexe : la copie part d'une conversation de premier rang.
  async annexer(req: Requete): Promise<Response> {
    const session = this.registre.session(req.params.id);
    if (!session) return erreur('session inconnue', 404);
    if (session.annexe_de) return erreur('une annexe n’a pas d’annexe', 400);
    const r = await this.postes.commander(session.machine, { kind: 'annexer', sessionId: session.id });
    return r.ok ? json(r.donnees ?? {}, 201) : erreur(r.erreur ?? 'annexe refusée', REFUS_POSTE);
  }

  private async commander(id: string, c: CommandeDeSession): Promise<Response> {
    const session = this.registre.session(id);
    if (!session) return erreur('session inconnue', 404);
    const r = await this.postes.commander(session.machine, { ...c, sessionId: id });
    return r.ok ? json(r.donnees ?? {}) : erreur(r.erreur ?? 'commande refusée', REFUS_POSTE);
  }
}

function nomDecode(brut: string): string {
  try {
    return decodeURIComponent(brut);
  } catch {
    return brut;
  }
}
