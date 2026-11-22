// Responsabilité : le lien sortant du nœud vers l'aiguilleur — un WebSocket `/aiguilleur` authentifié par le jeton
// du membre, rétabli avec recul. Il ne décide de rien : chaque message reçu est remis à l'appelant, validé par le
// protocole.
import type { Logger } from 'pino';
import {
  analyserDeAiguilleur,
  CHEMIN_LIEN_AIGUILLEUR,
  type MessageDeAiguilleur,
  type MessageVersAiguilleur,
} from '../../commun/aiguilleur.ts';

/** Codes de fermeture de l'aiguilleur : jeton révoqué, ou une autre connexion de ce membre a pris sa place. */
export const CODE_REVOQUE = 4401;
export const CODE_REMPLACE = 4409;

export type MotifArret = 'revoque' | 'remplace' | 'arrete';

export interface OptionsLien {
  readonly url: string;
  readonly jeton: string;
  readonly delaiMinMs: number;
  readonly delaiMaxMs: number;
  readonly journal: Logger;
}

export interface HandlersLien {
  surMessage(message: MessageDeAiguilleur): void;
  surConnexion(connecte: boolean): void;
  surArret(motif: MotifArret): void;
}

/** Adresse du lien : http → ws, https → wss, chemin de l'aiguilleur. Null si l'adresse est inutilisable. */
export function urlLienAiguilleur(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:') u.protocol = 'ws:';
    else if (u.protocol === 'https:') u.protocol = 'wss:';
    else return null;
    u.pathname = CHEMIN_LIEN_AIGUILLEUR;
    return u.toString();
  } catch {
    return null;
  }
}

export class LienAiguilleur {
  private ws: WebSocket | null = null;
  private connecteEtat = false;
  private arrete = true;
  private delai: number;
  private minuterie: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: OptionsLien,
    private readonly handlers: HandlersLien,
  ) {
    this.delai = options.delaiMinMs;
  }

  demarrer(): void {
    if (!this.arrete) return;
    this.arrete = false;
    this.connecter();
  }

  arreter(): void {
    this.arrete = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    const ws = this.ws;
    this.ws = null;
    this.connecteEtat = false;
    ws?.close(1000, 'arrêt');
  }

  connecte(): boolean {
    return this.connecteEtat;
  }

  /** Envoie un message à l'aiguilleur ; faux si le lien n'est pas ouvert (le message est perdu, l'appelant le sait). */
  envoyer(message: MessageVersAiguilleur): boolean {
    if (!this.ws || !this.connecteEtat) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private connecter(): void {
    const adresse = urlLienAiguilleur(this.options.url);
    if (!adresse) {
      this.options.journal.error('adresse de l’aiguilleur inutilisable');
      this.arrete = true;
      return;
    }
    const ws = new WebSocket(adresse, { headers: { authorization: `Bearer ${this.options.jeton}` } });
    this.ws = ws;
    ws.onopen = () => this.ouvert(ws);
    ws.onmessage = (ev) => this.recevoir(String(ev.data));
    ws.onclose = (ev) => this.ferme(ws, ev.code);
    ws.onerror = () => undefined; // la fermeture qui suit porte la suite
  }

  private ouvert(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.connecteEtat = true;
    this.delai = this.options.delaiMinMs;
    this.options.journal.info('lien vers l’aiguilleur ouvert');
    this.handlers.surConnexion(true);
  }

  private recevoir(brut: string): void {
    try {
      const message = analyserDeAiguilleur(JSON.parse(brut));
      if (message) this.handlers.surMessage(message);
      else this.options.journal.warn('message de l’aiguilleur hors protocole : ignoré');
    } catch (erreur) {
      this.options.journal.error({ err: erreur }, 'message de l’aiguilleur illisible');
    }
  }

  private ferme(ws: WebSocket, code: number): void {
    if (ws !== this.ws) return;
    const etaitOuvert = this.connecteEtat;
    this.ws = null;
    this.connecteEtat = false;
    if (etaitOuvert) this.handlers.surConnexion(false);
    if (this.arrete) return;
    if (code === CODE_REVOQUE || code === CODE_REMPLACE) {
      this.arrete = true;
      this.handlers.surArret(code === CODE_REVOQUE ? 'revoque' : 'remplace');
      return;
    }
    this.minuterie = setTimeout(() => this.connecter(), this.delai);
    this.delai = Math.min(this.delai * 2, this.options.delaiMaxMs);
  }
}
