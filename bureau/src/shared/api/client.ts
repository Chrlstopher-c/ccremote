// Responsabilité : parler à l'API du relais (HTTP) avec le jeton de l'appareil.
import type { CommandeVoix, EntreeHistoriqueEcho, EtatEcho, ReglagesEcho } from '../../../../commun/echo.ts';
import type {
  ActionSession,
  DemandeOuverture,
  EtatRelais,
  EvenementDate,
  Notification,
} from '../../../../commun/api-clients.ts';
import type { Projet, ReponseDialogue, ResumeSession } from '../../../../commun/session.ts';
import { journal } from '../journal.ts';

export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    message: string,
  ) {
    super(message);
  }
}

export class ClientRelais {
  constructor(
    readonly base: string,
    private readonly jeton: string,
  ) {}

  static async connecter(base: string, motDePasse: string): Promise<string> {
    const r = await fetch(`${base}/api/connexion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motDePasse, appareil: 'Quart bureau' }),
    });
    const corps = (await r.json()) as { jeton?: string; erreur?: string };
    if (!r.ok || !corps.jeton) throw new ErreurApi(r.status, corps.erreur ?? 'connexion refusée');
    return corps.jeton;
  }

  etat(): Promise<EtatRelais> {
    return this.appeler('GET', '/api/etat');
  }

  evenements(sessionId: string, apres?: number): Promise<EvenementDate[]> {
    const q = apres === undefined ? '' : `?apres=${apres}`;
    return this.appeler('GET', `/api/sessions/${sessionId}/evenements${q}`);
  }

  ouvrir(d: DemandeOuverture): Promise<ResumeSession> {
    return this.appeler('POST', '/api/sessions', d);
  }

  envoyer(sessionId: string, texte: string): Promise<ResumeSession> {
    return this.appeler('POST', `/api/sessions/${sessionId}/messages`, { texte });
  }

  agir(sessionId: string, action: ActionSession): Promise<ResumeSession> {
    return this.appeler('POST', `/api/sessions/${sessionId}/${action}`, {});
  }

  connecterCompte(machine: string, nom: string, email?: string): Promise<{ url: string }> {
    return this.appeler('POST', `/api/machines/${machine}/comptes`, email ? { nom, email } : { nom });
  }

  validerCompte(machine: string, nom: string, code: string): Promise<unknown> {
    return this.appeler('POST', `/api/machines/${machine}/comptes/${nom}/code`, { code });
  }

  retirerCompte(machine: string, nom: string): Promise<unknown> {
    return this.appeler('POST', `/api/machines/${machine}/comptes/${nom}/retirer`, {});
  }

  releverComptes(machine: string): Promise<unknown> {
    return this.appeler('POST', `/api/machines/${machine}/comptes/relever`, {});
  }

  repondre(sessionId: string, reponse: ReponseDialogue): Promise<ResumeSession> {
    return this.appeler('POST', `/api/sessions/${sessionId}/repondre`, reponse);
  }

  autonomie(sessionId: string, active: boolean): Promise<ResumeSession> {
    return this.appeler('POST', `/api/sessions/${sessionId}/autonomie`, { active });
  }

  notifications(apres = 0): Promise<Notification[]> {
    return this.appeler('GET', `/api/notifications?apres=${apres}`);
  }

  marquerLues(jusqua: number): Promise<void> {
    return this.appeler('POST', '/api/notifications/lues', { jusqua });
  }

  reveiller(machine: string): Promise<void> {
    return this.appeler('POST', `/api/machines/${machine}/reveiller`, {});
  }

  eteindre(machine: string): Promise<void> {
    return this.appeler('POST', `/api/machines/${machine}/eteindre`, {});
  }

  projets(machine: string): Promise<Projet[]> {
    return this.appeler('GET', `/api/machines/${machine}/projets`);
  }

  deconnecter(): Promise<void> {
    return this.appeler('POST', '/api/deconnexion', {});
  }

  urlFlux(): string {
    return `${this.base.replace(/^http/, 'ws')}/api/flux`;
  }

  get jetonFlux(): string {
    return this.jeton;
  }

  echoRegler(r: Partial<ReglagesEcho>): Promise<{ ok: boolean }> {
    return this.appeler('POST', '/api/echo/reglage', r);
  }

  echoVoix(action: CommandeVoix): Promise<{ ok: boolean }> {
    return this.appeler('POST', '/api/echo/voix', { action });
  }

  echoRetirer(id: string): Promise<{ ok: boolean }> {
    return this.appeler('POST', '/api/echo/retirer', { id });
  }

  echoEtat(): Promise<EtatEcho> {
    return this.appeler('GET', '/api/echo/etat');
  }

  echoHistorique(n = 150): Promise<EntreeHistoriqueEcho[]> {
    return this.appeler('GET', `/api/echo/historique?n=${n}`);
  }

  echoParler(texte: string): Promise<{ ok: boolean }> {
    return this.appeler('POST', '/api/echo/parler', { texte, appareil: 'app' });
  }

  echoInterrompre(): Promise<{ ok: boolean }> {
    return this.appeler('POST', '/api/echo/interrompre', {});
  }

  private async appeler<T>(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await fetch(`${this.base}${chemin}`, {
        method: methode,
        headers: {
          authorization: `Bearer ${this.jeton}`,
          ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      });
    } catch (erreur) {
      journal.warn({ chemin, erreur: String(erreur) }, 'relais injoignable');
      throw new ErreurApi(0, 'relais injoignable');
    }
    const texte = await r.text();
    const donnees: unknown = texte ? JSON.parse(texte) : {};
    if (!r.ok) throw new ErreurApi(r.status, (donnees as { erreur?: string }).erreur ?? `erreur ${r.status}`);
    return donnees as T; // forme garantie par le contrat commun/api-clients.ts, partagé avec le relais
  }
}
