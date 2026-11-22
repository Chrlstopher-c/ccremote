// Responsabilité : les réglages d'une session qui passent par le poste (style de sortie, connecteurs MCP) et ses
// conversations annexes — liste lue au registre, création par le poste. Le relais ne décide rien de ces réglages.
import { z } from 'zod';
import type { ResumeSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import type { Diffusion } from './diffusion.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';
import { type SessionAdoptable, sessionAdoptee } from './session-adoptee.ts';

const CorpsStyle = z.object({ style: z.string().min(1).max(80).nullable() });
const CorpsConnecteur = z.object({ actif: z.boolean() });
const ReponseMigration = z.object({ nouvelleSession: z.string().min(1) });

/** Migration réservée aux chefs du réseau dès qu'une charte existe ; sans charte, le nœud est seul et reste libre. */
export function refusMigrer(noeud: { charte: { charte(): unknown; chefLocal(): boolean } }): Response | null {
  if (noeud.charte.charte() === null || noeud.charte.chefLocal()) return null;
  return erreur('migration réservée aux chefs du réseau', 403);
}

type Requete = Request & { params: { id: string; nom?: string } };
type CommandeDeSession =
  | { readonly kind: 'style'; readonly style: string | null }
  | { readonly kind: 'styles' }
  | { readonly kind: 'connecteur'; readonly nom: string; readonly actif: boolean };

export class ApiSessionConfig {
  constructor(
    private readonly registre: Registre,
    private readonly postes: SessionAdoptable,
    private readonly diffusion: Diffusion | null = null,
  ) {}

  // Migration d'une session Desktop ou terminal vers Lanterne : le poste copie la conversation, la source reste intacte.
  // La source garde l'identifiant de sa reprise (« migrée vers ») ; l'épingle passe à la nouvelle session.
  async migrer(req: Requete): Promise<Response> {
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    if (session.migrable !== true) return erreur('session non migrable : Desktop ou terminal, pas encore migrée', 409);
    const r = await this.postes.commander(session.machine, { kind: 'migrer', sessionId: session.id });
    if (!r.ok) return erreur(r.erreur ?? 'migration refusée', REFUS_POSTE);
    const reponse = ReponseMigration.safeParse(r.donnees);
    if (!reponse.success) return erreur('migration : réponse du poste illisible', REFUS_POSTE);
    const nouvelle = reponse.data.nouvelleSession;
    this.registre.definirMigreeVers(session.id, nouvelle);
    this.registre.definirEpinglee(nouvelle, session.epinglee === true);
    const vue = this.registre.session(session.id);
    if (vue) this.diffusion?.diffuser({ type: 'session', session: vue });
    return json({ nouvelleSession: nouvelle }, 201);
  }

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

  async annexes(req: Requete): Promise<Response> {
    const id = req.params.id;
    const session = await this.sessionDe(id);
    if (session instanceof Response) return session;
    const liste = this.registre
      .sessions(true)
      .filter((s) => s.annexe_de === id)
      .sort((a, b) => a.creeLe.localeCompare(b.creeLe))
      .map((s) => ({ id: s.id, titre: s.titre, cree_le: s.creeLe }));
    return json(liste);
  }

  // Une annexe n'a pas d'annexe : la copie part d'une conversation de premier rang.
  async annexer(req: Requete): Promise<Response> {
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    if (session.annexe_de) return erreur('une annexe n’a pas d’annexe', 400);
    const r = await this.postes.commander(session.machine, { kind: 'annexer', sessionId: session.id });
    return r.ok ? json(r.donnees ?? {}, 201) : erreur(r.erreur ?? 'annexe refusée', REFUS_POSTE);
  }

  private sessionDe(id: string): Promise<ResumeSession | Response> {
    return sessionAdoptee(this.registre, this.postes, id);
  }

  private async commander(id: string, c: CommandeDeSession): Promise<Response> {
    const session = await this.sessionDe(id);
    if (session instanceof Response) return session;
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
