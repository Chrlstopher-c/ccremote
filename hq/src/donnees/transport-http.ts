// Responsabilité : le client HTTP du relais — appels authentifiés par jeton porteur, erreurs typées et journalisées.
import type { ActionSession, EtatRelais, EvenementDate, ReponseDialogue } from './contrat';
import { journaliser } from './journal';
import type { ApiMonde } from './source-monde';

export type Recuperer = (url: string, init: RequestInit) => Promise<Response>;

export class ErreurRelais extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
  }
}

export class ClientRelais implements ApiMonde {
  private readonly racine: string;

  constructor(
    base: string,
    private readonly jeton: string,
    private readonly recuperer: Recuperer,
  ) {
    this.racine = base.replace(/\/+$/, '');
  }

  etat(): Promise<EtatRelais> {
    return this.appeler<EtatRelais>('GET', '/api/etat');
  }

  async evenements(sessionId: string): Promise<EvenementDate[]> {
    return this.appeler<EvenementDate[]>('GET', `/api/sessions/${encodeURIComponent(sessionId)}/evenements`);
  }

  async envoyerMessage(sessionId: string, texte: string): Promise<void> {
    await this.appeler('POST', `/api/sessions/${encodeURIComponent(sessionId)}/messages`, { texte });
  }

  async repondre(sessionId: string, reponse: ReponseDialogue): Promise<void> {
    await this.appeler('POST', `/api/sessions/${encodeURIComponent(sessionId)}/repondre`, reponse);
  }

  async agir(sessionId: string, action: ActionSession): Promise<void> {
    await this.appeler('POST', `/api/sessions/${encodeURIComponent(sessionId)}/${action}`, {});
  }

  private async appeler<T = void>(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<T> {
    const reponse = await this.envoyer(methode, chemin, corps);
    const texte = await reponse.text();
    const donnees = analyser(texte, reponse.status);
    if (!reponse.ok) throw new ErreurRelais(reponse.status, messageDErreur(donnees, reponse.status));
    return donnees as T; // forme garantie par le contrat du relais (commun/api-clients.ts), miroir dans contrat.ts
  }

  private async envoyer(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<Response> {
    const init: RequestInit = {
      method: methode,
      headers: {
        authorization: `Bearer ${this.jeton}`,
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    };
    try {
      return await this.recuperer(`${this.racine}${chemin}`, init);
    } catch (erreur) {
      journaliser('warn', 'relais injoignable', { chemin, erreur: String(erreur) });
      throw new ErreurRelais(0, 'relais injoignable');
    }
  }
}

function analyser(texte: string, statut: number): unknown {
  if (!texte) return {};
  try {
    return JSON.parse(texte);
  } catch {
    throw new ErreurRelais(statut, 'réponse du relais illisible');
  }
}

function messageDErreur(donnees: unknown, statut: number): string {
  if (typeof donnees === 'object' && donnees !== null && 'erreur' in donnees) {
    const { erreur } = donnees;
    if (typeof erreur === 'string') return erreur;
  }
  return `erreur ${statut}`;
}
