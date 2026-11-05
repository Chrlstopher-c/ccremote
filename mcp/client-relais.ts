// Responsabilité : parler à l'API du relais Quart avec un jeton porteur — le seul point de contact réseau du MCP.
import type { Evenement, Projet, ResumeSession } from '../commun/session.ts';

export interface VueMachineMcp {
  readonly id: string;
  readonly description: string;
  readonly enLigne: boolean;
  readonly projets?: readonly Projet[];
}

export interface EtatParc {
  readonly machines: readonly VueMachineMcp[];
  readonly sessions: readonly ResumeSession[];
  readonly reveilPossible: readonly string[];
}

export interface EvenementDate {
  readonly seq: number;
  readonly ts: string;
  readonly evt: Evenement;
}

export interface DemandeOuverture {
  readonly machine: string;
  readonly projet: Projet;
  readonly message: string;
  readonly titre?: string;
  readonly objectif?: string | null;
  readonly autonomie?: boolean;
  readonly modele?: string;
  readonly compte?: string;
}

export type ActionSession = 'interrompre' | 'compacter' | 'fermer' | 'reprendre';

export class ErreurRelais extends Error {
  constructor(
    message: string,
    readonly statut: number,
  ) {
    super(message);
  }
}

export class ClientRelais {
  constructor(
    private readonly url: string,
    private readonly jeton: string,
  ) {}

  etat(): Promise<EtatParc> {
    return this.requete<EtatParc>('GET', '/api/etat');
  }

  projets(machine: string): Promise<readonly Projet[]> {
    return this.requete<readonly Projet[]>('GET', `/api/machines/${encodeURIComponent(machine)}/projets`);
  }

  ouvrir(d: DemandeOuverture): Promise<ResumeSession> {
    return this.requete('POST', '/api/sessions', d);
  }

  evenements(session: string, apres: number | null, attendreS: number): Promise<readonly EvenementDate[]> {
    const q = apres === null ? '' : `?apres=${apres}&attendre=${attendreS}`;
    return this.requete('GET', `/api/sessions/${encodeURIComponent(session)}/evenements${q}`, undefined, attendreS);
  }

  envoyer(session: string, texte: string): Promise<unknown> {
    return this.requete('POST', `/api/sessions/${encodeURIComponent(session)}/messages`, { texte });
  }

  repondre(session: string, reponse: { id: string; index?: number; texte?: string }): Promise<unknown> {
    return this.requete('POST', `/api/sessions/${encodeURIComponent(session)}/repondre`, reponse);
  }

  action(session: string, action: ActionSession): Promise<unknown> {
    return this.requete('POST', `/api/sessions/${encodeURIComponent(session)}/${action}`, {});
  }

  reveiller(machine: string): Promise<unknown> {
    return this.requete('POST', `/api/machines/${encodeURIComponent(machine)}/reveiller`, {});
  }

  private async requete<T>(methode: string, chemin: string, corps?: unknown, attenteS = 0): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${this.url}${chemin}`, {
        method: methode,
        headers: { authorization: `Bearer ${this.jeton}`, 'content-type': 'application/json' },
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
        signal: AbortSignal.timeout((20 + attenteS) * 1000),
      });
    } catch (e) {
      throw new ErreurRelais(`relais Quart injoignable (${String(e)})`, 0);
    }
    const texte = await r.text();
    if (!r.ok) throw new ErreurRelais(messageErreur(texte, r.status), r.status);
    return (texte ? JSON.parse(texte) : {}) as T; // contrat de l'API du relais (relais/clients), même dépôt
  }
}

function messageErreur(texte: string, statut: number): string {
  if (statut === 401) return 'jeton refusé par le relais (révoqué ou expiré) : réémettre avec mcp/emettre-jeton.ts';
  try {
    const j = JSON.parse(texte) as { erreur?: unknown };
    if (typeof j.erreur === 'string') return `${j.erreur} (${statut})`;
  } catch {
    // corps non JSON : on rend le texte brut
  }
  return `${texte.slice(0, 200) || 'réponse vide'} (${statut})`;
}
