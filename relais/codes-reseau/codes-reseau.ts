// Responsabilité : la création d'un code d'appairage demandée depuis l'appli — relayée à l'aiguilleur avec l'adresse et
// le jeton de membre de ce nœud (secrets de la fédération). Le nœud ne garde ni le code ni son échéance, et ne
// journalise que le statut : jamais le code, jamais le jeton.
import type { Logger } from 'pino';
import { CHEMIN_CODES_MEMBRE, type CorpsCodeMembre, ReponseCodeMembre } from '../../commun/aiguilleur.ts';
import { echec, ok, type Resultat } from '../federation/resultat.ts';
import type { SecretsNoeud } from '../federation/secrets.ts';

const DELAI_MS = 10_000;

export class CodesReseau {
  constructor(
    private readonly secrets: SecretsNoeud,
    private readonly journal: Logger,
  ) {}

  async creer(corps: CorpsCodeMembre): Promise<Resultat<ReponseCodeMembre>> {
    const config = this.secrets.lireAiguilleur();
    if (!config) return echec(409, 'nœud non relié à un aiguilleur');
    try {
      const rep = await fetch(new URL(CHEMIN_CODES_MEMBRE, config.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.jeton}` },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(DELAI_MS),
      });
      return await this.lire(rep);
    } catch (erreur) {
      this.journal.warn({ err: erreur }, 'code : aiguilleur injoignable');
      return echec(502, 'aiguilleur injoignable');
    }
  }

  private async lire(rep: Response): Promise<Resultat<ReponseCodeMembre>> {
    if (!rep.ok) {
      this.journal.warn({ statut: rep.status }, 'code : refusé par l’aiguilleur');
      return echecAiguilleur(rep.status);
    }
    const r = ReponseCodeMembre.safeParse(await rep.json());
    return r.success ? ok(r.data) : echec(502, 'réponse de l’aiguilleur non conforme');
  }
}

// Un 401 de l'aiguilleur veut dire que ce nœud n'est plus membre (révoqué) : ce n'est pas le jeton de l'appli.
function echecAiguilleur(statut: number): Resultat<never> {
  switch (statut) {
    case 400:
      return echec(400, 'requête refusée par l’aiguilleur');
    case 401:
      return echec(409, 'ce nœud n’est plus reconnu par l’aiguilleur');
    case 429:
      return echec(429, 'trop de codes actifs : attends qu’un code soit utilisé ou expire');
    default:
      return echec(502, 'aiguilleur indisponible');
  }
}
