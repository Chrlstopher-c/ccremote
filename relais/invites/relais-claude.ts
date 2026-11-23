// Responsabilité : le relais Claude d'un nœud — reçoit les messages `claude_*` et leurs morceaux, les range entre le
// côté invité (route locale, réponses) et le côté chef (corps réuni, appel de l'API). Pas de règle ici : les verdicts
// sont dans relais-claude-verdict.ts, l'appel dans relais-claude-serveur.ts.
import type { Logger } from 'pino';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { ClaudeRequete } from '../../commun/relais-claude.ts';
import { Reassemblage } from '../federation/transferts.ts';
import { ClientClaude, PREFIXE_ROUTE_CLAUDE, type PortClientClaude } from './relais-claude-client.ts';
import { type EmetteurClaude, ServeurClaude, type PortServeurClaude } from './relais-claude-serveur.ts';

type Morceau = Extract<MessageChiffre, { t: 'morceau' }>;

interface CorpsAttendu {
  readonly canal: EmetteurClaude;
  readonly requete: ClaudeRequete;
  readonly nombre: number;
  recus: number;
}

export interface PortRelaisClaude {
  readonly client: PortClientClaude;
  readonly serveur: Omit<PortServeurClaude, 'suivi'>;
  readonly suivi: PortServeurClaude['suivi'];
  readonly journal: Logger;
}

export class RelaisClaude {
  readonly client: ClientClaude;
  readonly serveur: ServeurClaude;
  private readonly corpsEnAttente = new Map<string, CorpsAttendu>();
  private readonly transferts = new Reassemblage();

  constructor(private readonly p: PortRelaisClaude) {
    this.client = new ClientClaude(p.client);
    this.serveur = new ServeurClaude({ ...p.serveur, suivi: p.suivi });
  }

  /** Les routes à ajouter au serveur local : la route de Claude Code, qui ne passe pas par le jeton de l'appli. */
  routes(): Record<string, (req: Request) => Promise<Response>> {
    return { [`${PREFIXE_ROUTE_CLAUDE}/*`]: (req) => this.client.routeLocale(req) };
  }

  jetonRelais(): string {
    return this.p.client.jetonRelais();
  }

  /** Une référence de requête Claude ou de réponse Claude : les morceaux qui la portent ne vont pas ailleurs. */
  possede(ref: string): boolean {
    return this.client.possede(ref) || this.corpsEnAttente.has(ref);
  }

  /** Un message `claude_*` ou un morceau qui relève du relais, reçu d'un pair relié. */
  messageRecu(canal: EmetteurClaude, m: MessageChiffre): void {
    switch (m.t) {
      case 'claude_requete':
        return this.requete(canal, m);
      case 'claude_annuler':
        return this.serveur.annuler(canal.membre, m.ref);
      case 'claude_entete':
      case 'claude_fin':
        return this.client.recevoir(canal.membre, m);
      case 'morceau':
        return this.morceau(canal, m);
      default:
        return undefined;
    }
  }

  /** Le lien avec un pair tombe : ses appels, ses corps en attente et ses réponses en route s'arrêtent. */
  oublier(membre: string): void {
    this.client.oublier(membre);
    this.serveur.annulerTout(membre);
    this.transferts.oublier(membre);
    for (const [ref, attente] of [...this.corpsEnAttente]) {
      if (attente.canal.membre === membre) this.corpsEnAttente.delete(ref);
    }
  }

  private requete(canal: EmetteurClaude, m: ClaudeRequete): void {
    if (m.morceaux === undefined) {
      this.lancer(canal, m, Buffer.from(m.corps ?? '', 'base64'));
      return;
    }
    this.corpsEnAttente.set(m.ref, { canal, requete: m, nombre: m.morceaux, recus: 0 });
  }

  private morceau(canal: EmetteurClaude, m: Morceau): void {
    const attente = this.corpsEnAttente.get(m.ref);
    if (attente === undefined) return this.client.morceau(canal.membre, m);
    if (attente.canal.membre !== canal.membre) return undefined;
    if (!this.transferts.recevoir(canal.membre, m)) return this.abandonner(canal, m.ref, 'corps reçu hors d’ordre');
    attente.recus += 1;
    if (attente.recus < attente.nombre) return undefined;
    this.corpsEnAttente.delete(m.ref);
    const corps = this.transferts.assembler(canal.membre, m.ref, attente.nombre);
    if (corps === null) return this.abandonner(canal, m.ref, 'corps incomplet');
    this.lancer(canal, attente.requete, Buffer.from(corps, 'base64'));
    return undefined;
  }

  private lancer(canal: EmetteurClaude, requete: ClaudeRequete, corps: Uint8Array): void {
    this.serveur.traiter(canal, requete, corps).catch((erreur: unknown) => {
      this.p.journal.error({ err: erreur, membre: canal.membre }, 'relais Claude : requête en échec');
    });
  }

  private abandonner(canal: EmetteurClaude, ref: string, raison: string): void {
    this.corpsEnAttente.delete(ref);
    this.serveur.refuser(canal, ref, 400, 'invalid_request_error', raison);
  }
}
