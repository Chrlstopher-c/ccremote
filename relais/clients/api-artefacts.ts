// Responsabilité : les artefacts par l'API des clients — liste de toutes les sessions connues (un poste absent est
// ignoré, il n'est pas une erreur globale) et gestes sur un artefact (renommer, dupliquer, supprimer, épingler). Le
// relais ne garde rien : chaque geste part vers le poste qui héberge la session.
import type { Logger } from 'pino';
import { z } from 'zod';
import { estIdArtefact } from '../../commun/presentation.ts';
import type { Registre } from '../registre/registre.ts';
import type { Postes } from '../parc/postes.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';
import { type SessionAdoptable, sessionAdoptee } from './session-adoptee.ts';

type Requete = Request & { params: Record<string, string> };
type Commander = Pick<Postes, 'commander'>['commander'];
type Commande = Parameters<Commander>[1];
interface Cible {
  readonly machine: string;
  readonly session: string;
  readonly artefact: string;
}

const CorpsTitre = z.object({ titre: z.string().trim().min(1).max(120) });
const CorpsEpingle = z.object({ epingle: z.boolean() });
const ArtefactPoste = z.object({
  id: z.string(),
  session: z.string(),
  titre: z.string(),
  url: z.null(),
  publieLe: z.string(),
  epingle: z.boolean(),
  chemin: z.string(),
  versions: z.array(z.object({ version: z.number(), fichier: z.string(), publieLe: z.string() })),
});

export class ApiArtefacts {
  constructor(
    private readonly registre: Registre,
    private readonly postes: SessionAdoptable,
    private readonly journal: Logger,
  ) {}

  /** Artefacts de toutes les sessions connues, rangées comprises. Un poste qui ne répond pas n'en apporte aucun. */
  async lister(): Promise<Response> {
    const sessions = this.registre.sessions(true).filter((s) => !s.annexe_de); // les annexes n'ont pas d'artefacts
    const reponses = await Promise.all(
      sessions.map((session) => this.postes.commander(session.machine, { kind: 'artefacts', sessionId: session.id })),
    );
    const artefacts = reponses.flatMap((reponse) => {
      if (!reponse.ok) return [];
      const lus = z.array(ArtefactPoste).safeParse(reponse.donnees);
      if (!lus.success) this.journal.warn({ erreur: lus.error.message }, 'réponse d’artefacts illisible');
      return lus.success ? lus.data : [];
    });
    return json(artefacts);
  }

  async renommer(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    const corps = await lireCorps(req, CorpsTitre);
    if (corps instanceof Response) return corps;
    return this.envoyer(cible, {
      kind: 'artefact_renommer',
      sessionId: cible.session,
      artefact: cible.artefact,
      titre: corps.titre,
    });
  }

  async dupliquer(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    return this.envoyer(cible, { kind: 'artefact_dupliquer', sessionId: cible.session, artefact: cible.artefact });
  }

  async supprimer(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    return this.envoyer(cible, { kind: 'artefact_supprimer', sessionId: cible.session, artefact: cible.artefact });
  }

  async epingler(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    const corps = await lireCorps(req, CorpsEpingle);
    if (corps instanceof Response) return corps;
    return this.envoyer(cible, {
      kind: 'artefact_epingler',
      sessionId: cible.session,
      artefact: cible.artefact,
      epingle: corps.epingle,
    });
  }

  /** Commande envoyée au poste de la session ; un refus du poste part au client tel quel. */
  private async envoyer(cible: Cible, commande: Commande): Promise<Response> {
    const r = await this.postes.commander(cible.machine, commande);
    if (!r.ok) {
      this.journal.warn(
        { session: cible.session, artefact: cible.artefact, erreur: r.erreur },
        'geste sur un artefact refusé',
      );
      return erreur(r.erreur ?? 'geste refusé', REFUS_POSTE);
    }
    return json(r.donnees ?? { ok: true });
  }

  private async cible(req: Requete): Promise<Cible | Response> {
    const session = await sessionAdoptee(this.registre, this.postes, req.params['id'] ?? '');
    if (session instanceof Response) return session;
    const artefact = req.params['artefact'] ?? '';
    if (!estIdArtefact(artefact)) return erreur('artefact inconnu', 404);
    return { machine: session.machine, session: session.id, artefact };
  }
}
