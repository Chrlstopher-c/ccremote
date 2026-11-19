// Responsabilité : le panneau Fichiers d'une session par l'API des clients — arbre du dossier de la session, lecture et
// enregistrement d'un fichier. Le relais ne garde rien : il transmet au poste qui héberge la session, qui borne les
// chemins à son dossier. Un refus du poste part au client avec son message.
import type { Logger } from 'pino';
import { z } from 'zod';
import { CheminSession, TAILLE_MAX_TEXTE_SESSION } from '../../commun/fichiers-session.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from './http.ts';

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
    private readonly postes: Pick<Postes, 'commander'>,
    private readonly journal: Logger,
  ) {}

  async arbre(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const q = lireRequete(req, RequeteChemin);
    if (q instanceof Response) return q;
    return this.envoyer(cible, { kind: 'session_arbre', sessionId: cible.sessionId, chemin: q.chemin });
  }

  async lire(req: Requete): Promise<Response> {
    const cible = this.cible(req);
    if (cible instanceof Response) return cible;
    const q = lireRequete(req, RequeteChemin);
    if (q instanceof Response) return q;
    return this.envoyer(cible, { kind: 'session_lire', sessionId: cible.sessionId, chemin: q.chemin });
  }

  async ecrire(req: Requete): Promise<Response> {
    const cible = this.cible(req);
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

  private cible(req: Requete): Cible | Response {
    const session = this.registre.session(req.params['id'] ?? '');
    return session ? { machine: session.machine, sessionId: session.id } : erreur('session inconnue', 404);
  }
}

function lireRequete<S extends z.ZodType>(req: Request, schema: S): z.infer<S> | Response {
  const lu = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  return lu.success
    ? lu.data
    : erreur(`requête invalide : ${lu.error.issues.map((i) => i.path.join('.')).join(' ; ')}`);
}
