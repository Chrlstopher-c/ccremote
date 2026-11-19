// Responsabilité : le panneau Fichiers d'une session par l'API des clients — arbre du dossier de la session, lecture et
// enregistrement d'un fichier. Le relais ne garde rien : il transmet au poste qui héberge la session, qui borne les
// chemins à son dossier. Un refus du poste part au client avec son message.
import type { Logger } from 'pino';
import { z } from 'zod';
import { CheminSession, TAILLE_MAX_TEXTE_SESSION } from '../../commun/fichiers-session.ts';
import type { Registre } from '../registre/registre.ts';
import type { Postes } from '../parc/postes.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';
import { type SessionAdoptable, sessionAdoptee } from './session-adoptee.ts';

type Requete = Request & { params: Record<string, string> };

const CorpsEcriture = z.object({ chemin: CheminSession, texte: z.string().max(TAILLE_MAX_TEXTE_SESSION * 4) });
const RequeteChemin = z.object({ chemin: CheminSession.default('') });

interface Cible {
  readonly machine: string;
  readonly sessionId: string;
}

export class ApiFichiersSession {
  constructor(
    private readonly registre: Registre,
    private readonly postes: SessionAdoptable,
    private readonly journal: Logger,
  ) {}

  async arbre(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    const q = lireRequete(req, RequeteChemin);
    if (q instanceof Response) return q;
    return this.envoyer(cible, { kind: 'session_arbre', sessionId: cible.sessionId, chemin: q.chemin });
  }

  async lire(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    const q = lireRequete(req, RequeteChemin);
    if (q instanceof Response) return q;
    return this.envoyer(cible, { kind: 'session_lire', sessionId: cible.sessionId, chemin: q.chemin });
  }

  /** Menu « / » : compétences et commandes de la session, lues sur son poste. */
  async competences(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    return this.envoyer(cible, { kind: 'session_competences', sessionId: cible.sessionId });
  }

  /** Menu « @ » : fichiers du projet de la session, lus sur son poste. */
  async fichiers(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    return this.envoyer(cible, { kind: 'session_fichiers', sessionId: cible.sessionId });
  }

  async ecrire(req: Requete): Promise<Response> {
    const cible = await this.cible(req);
    if (cible instanceof Response) return cible;
    const c = await lireCorps(req, CorpsEcriture);
    if (c instanceof Response) return c;
    if (Buffer.byteLength(c.texte, 'utf8') > TAILLE_MAX_TEXTE_SESSION) {
      return erreur('fichier trop grand pour l’éditeur', 413);
    }
    return this.envoyer(cible, {
      kind: 'session_ecrire',
      sessionId: cible.sessionId,
      chemin: c.chemin,
      texte: c.texte,
    });
  }

  private async envoyer(cible: Cible, commande: Parameters<Postes['commander']>[1]): Promise<Response> {
    const r = await this.postes.commander(cible.machine, commande);
    if (!r.ok) {
      this.journal.warn(
        { session: cible.sessionId, commande: commande.kind, erreur: r.erreur },
        'panneau Fichiers refusé',
      );
      return erreur(r.erreur ?? 'refusé', REFUS_POSTE);
    }
    return json(r.donnees ?? { ok: true });
  }

  private async cible(req: Requete): Promise<Cible | Response> {
    const session = await sessionAdoptee(this.registre, this.postes, req.params['id'] ?? '');
    return session instanceof Response ? session : { machine: session.machine, sessionId: session.id };
  }
}

function lireRequete<S extends z.ZodType>(req: Request, schema: S): z.infer<S> | Response {
  const lu = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  return lu.success
    ? lu.data
    : erreur(`requête invalide : ${lu.error.issues.map((i) => i.path.join('.')).join(' ; ')}`);
}
