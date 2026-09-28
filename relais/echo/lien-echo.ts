// Responsabilité : le lien du relais vers Echo (cerveau sur le Pi) — un WebSocket, relayé dans le flux des clients.
import type { Logger } from 'pino';
import type { EntreeHistoriqueEcho, MessageEcho } from '../../commun/echo.ts';
import type { Diffusion } from '../clients/diffusion.ts';

const RECONNEXION_MS = 5_000;

export class LienEcho {
  private ws: WebSocket | null = null;
  private occupe = false;

  constructor(
    private readonly url: string,
    private readonly jeton: string,
    private readonly diffusion: Diffusion,
    private readonly journal: Logger,
  ) {}

  get etat(): { readonly joignable: boolean; readonly occupe: boolean } {
    return { joignable: this.ws?.readyState === WebSocket.OPEN, occupe: this.occupe };
  }

  demarrer(): void {
    // Bun accepte des en-têtes en option du constructeur, absents des types DOM.
    const ws = new WebSocket(`${this.url.replace(/^http/, 'ws')}/conversation`, {
      headers: { Authorization: `Bearer ${this.jeton}` },
    } as unknown as string[]);
    ws.onopen = (): void => this.journal.info('lien Echo ouvert');
    ws.onmessage = (e): void => this.relayer(String(e.data));
    ws.onclose = (): void => {
      this.ws = null;
      setTimeout(() => this.demarrer(), RECONNEXION_MS);
    };
    ws.onerror = (): void => this.journal.warn('lien Echo en erreur');
    this.ws = ws;
  }

  parler(texte: string, origine: string): boolean {
    return this.envoyer({ type: 'parler', texte, origine });
  }

  interrompre(): boolean {
    return this.envoyer({ type: 'interrompre' });
  }

  async historique(n: number): Promise<EntreeHistoriqueEcho[]> {
    const r = await fetch(`${this.url}/historique?n=${n}`, {
      headers: { Authorization: `Bearer ${this.jeton}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`historique d'Echo : ${r.status}`);
    return (await r.json()) as EntreeHistoriqueEcho[]; // contrat d'Echo, commun/echo.ts
  }

  private envoyer(m: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  private relayer(brut: string): void {
    try {
      const echo = JSON.parse(brut) as MessageEcho; // émis par Echo selon son contrat
      if (echo.type === 'etat') this.occupe = echo.occupe;
      this.diffusion.diffuser({ type: 'echo', echo });
    } catch (err) {
      this.journal.warn({ err }, 'message d’Echo illisible');
    }
  }
}
