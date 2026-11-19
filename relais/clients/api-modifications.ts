// Responsabilité : les modifications d'une session par l'API des clients — git du dossier (fichiers modifiés, diff,
// annulation, commit) et fichiers touchés par tour (liste, diff, annulation). Le relais ne garde rien : chaque geste
// part vers le poste qui héberge la session, et un refus du poste part au client avec son message.
import type { Logger } from 'pino';
import { z } from 'zod';
import { CheminModifie, PorteeModifications, TourRef } from '../../commun/modifications.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';

type Requete = Request & { params: Record<string, string> };
type Commande = Parameters<Pick<Postes, 'commander'>['commander']>[1];
interface Cible {
  readonly machine: string;
  readonly session: string;
}

const CorpsChemin = z.object({ chemin: CheminModifie });
const CorpsMessage = z.object({ message: z.string().min(1).max(2000) });
const RequetePortee = z.object({ portee: PorteeModifications });
const RequeteDiff = z.object({ portee: PorteeModifications, chemin: CheminModifie });
const RequeteChemin = z.object({ chemin: CheminModifie });

export class ApiModifications {
  constructor(
    private readonly registre: Registre,
    private readonly postes: Pick<Postes, 'commander'>,
    private readonly journal: Logger,
  ) {}

  async modifications(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const q = lireRequete(req, RequetePortee);
    if (q instanceof Response) return q;
    return this.envoyer(cible, { kind: 'git_modifications', sessionId: cible.session, portee: q.portee });
  }

  async diff(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const q = lireRequete(req, RequeteDiff);
    if (q instanceof Response) return q;
    return this.envoyer(cible, { kind: 'git_diff', sessionId: cible.session, portee: q.portee, chemin: q.chemin });
  }

  async annuler(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const c = await lireCorps(req, CorpsChemin);
    if (c instanceof Response) return c;
    return this.envoyer(cible, { kind: 'git_annuler', sessionId: cible.session, chemin: c.chemin });
  }

  async commiter(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const c = await lireCorps(req, CorpsMessage);
    if (c instanceof Response) return c;
    return this.envoyer(cible, { kind: 'git_commiter', sessionId: cible.session, message: c.message });
  }

  async tourModifications(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const tour = lireTour(req);
    if (tour instanceof Response) return tour;
    return this.envoyer(cible, { kind: 'tour_modifications', sessionId: cible.session, tour });
  }

  async tourDiff(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const tour = lireTour(req);
    if (tour instanceof Response) return tour;
    const q = lireRequete(req, RequeteChemin);
    if (q instanceof Response) return q;
    return this.envoyer(cible, { kind: 'tour_diff', sessionId: cible.session, tour, chemin: q.chemin });
  }

  async tourAnnuler(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const tour = lireTour(req);
    if (tour instanceof Response) return tour;
    return this.envoyer(cible, { kind: 'tour_annuler', sessionId: cible.session, tour });
  }

  /** Commande envoyée au poste de la session ; un refus part au client avec le message du poste. */
  private async envoyer(cible: Cible, commande: Commande): Promise<Response> {
    const r = await this.postes.commander(cible.machine, commande);
    if (!r.ok) {
      this.journal.warn(
        { session: cible.session, commande: commande.kind, erreur: r.erreur },
        'geste sur les modifications refusé',
      );
      return erreur(r.erreur ?? 'geste refusé', r.erreur === 'tour inconnu' ? 404 : REFUS_POSTE);
    }
    return json(r.donnees ?? {});
  }

  private cible(req: Requete): Cible | Response {
    const session = this.registre.session(req.params['id'] ?? '');
    return session ? { machine: session.machine, session: session.id } : erreur('session inconnue', 404);
  }
}

function lireTour(req: Requete): string | Response {
  const lu = TourRef.safeParse(req.params['tour'] ?? '');
  return lu.success ? lu.data : erreur('tour invalide', 400);
}

function lireRequete<S extends z.ZodType>(req: Request, schema: S): z.infer<S> | Response {
  const lu = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (lu.success) return lu.data;
  return erreur(`requête invalide : ${lu.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join(' ; ')}`);
}
