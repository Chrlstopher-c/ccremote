// Responsabilité : les demandes faites à l'aiguilleur au nom de ce nœud (son jeton de membre) — un code d'appairage, et
// un accès VPN pour un invité. Le nœud ne garde ni le code, ni la configuration VPN, et ne journalise que le statut :
// jamais le code, jamais le jeton, jamais la clé privée.
import type { Logger } from 'pino';
import {
  CHEMIN_CODES_MEMBRE,
  CHEMIN_VPN_INVITES,
  type CorpsCodeMembre,
  DELAI_VPN_INVITES_MS,
  ReponseCodeMembre,
  ReponseVpnInvite,
} from '../../commun/aiguilleur.ts';
import { echec, ok, type Resultat } from '../federation/resultat.ts';
import type { ConfigAiguilleur, SecretsNoeud } from '../federation/secrets.ts';

const DELAI_MS = 10_000;
// L'aiguilleur attend son service root jusqu'à DELAI_VPN_INVITES_MS : le nœud attend un peu plus longtemps.
const DELAI_VPN_NOEUD_MS = DELAI_VPN_INVITES_MS + 5_000;

export class CodesReseau {
  constructor(
    private readonly secrets: SecretsNoeud,
    private readonly journal: Logger,
  ) {}

  /** La liaison à l'aiguilleur (URL, nom de ce nœud), ou null si ce nœud n'est pas relié. */
  configuration(): ConfigAiguilleur | null {
    return this.secrets.lireAiguilleur();
  }

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

  /** Accès VPN pour un invité : l'aiguilleur crée la paire et rend l'adresse et la configuration à remettre. */
  async demanderVpn(): Promise<Resultat<ReponseVpnInvite>> {
    const config = this.secrets.lireAiguilleur();
    if (!config) return echec(409, 'nœud non relié à un aiguilleur');
    try {
      const rep = await fetch(new URL(CHEMIN_VPN_INVITES, config.url), {
        method: 'POST',
        headers: { authorization: `Bearer ${config.jeton}` },
        signal: AbortSignal.timeout(DELAI_VPN_NOEUD_MS),
      });
      return await this.lireVpn(rep);
    } catch (erreur) {
      this.journal.warn({ err: erreur }, 'vpn : aiguilleur injoignable');
      return echec(502, 'aiguilleur injoignable');
    }
  }

  private async lireVpn(rep: Response): Promise<Resultat<ReponseVpnInvite>> {
    if (!rep.ok) {
      this.journal.warn({ statut: rep.status }, 'vpn : refusé par l’aiguilleur');
      return echecVpn(rep.status, await detailErreur(rep));
    }
    const r = ReponseVpnInvite.safeParse(await rep.json());
    return r.success ? ok(r.data) : echec(502, 'réponse de l’aiguilleur non conforme');
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

// Message d'erreur de l'aiguilleur (`{erreur}`), lisible par Chris ; absent ou illisible : null.
async function detailErreur(rep: Response): Promise<string | null> {
  try {
    const corps: unknown = await rep.json();
    return typeof corps === 'object' && corps !== null && 'erreur' in corps && typeof corps.erreur === 'string'
      ? corps.erreur
      : null;
  } catch {
    return null;
  }
}

// 501 : le VPN des invités n'est pas configuré chez l'aiguilleur (l'invitation partira sans VPN, cf. invitation.ts).
function echecVpn(statut: number, detail: string | null): Resultat<never> {
  switch (statut) {
    case 401:
      return echec(409, 'ce nœud n’est plus reconnu par l’aiguilleur');
    case 403:
      return echec(403, 'seul un nœud demande un accès VPN');
    case 429:
      return echec(429, detail ?? 'trop de demandes VPN en cours');
    case 501:
      return echec(501, 'VPN des invités non configuré chez l’aiguilleur');
    case 503:
      return echec(503, detail ?? 'service VPN de l’aiguilleur indisponible');
    case 504:
      return echec(504, 'le service VPN de l’aiguilleur n’a pas répondu');
    default:
      return echec(502, 'aiguilleur indisponible');
  }
}
