// Responsabilité : le flux temps réel du relais (WebSocket), reconnecté tout seul, jeton en sous-protocole.
import type { MessageClient } from '../../../../commun/api-clients.ts';
import { journal } from '../journal.ts';

export type EtatLien = 'connexion' | 'ouvert' | 'coupe';

export class FluxRelais {
  private ws: WebSocket | null = null;
  private attenteMs = 1_000;
  private arrete = false;

  constructor(
    private readonly url: string,
    private readonly jeton: string,
    private readonly surMessage: (m: MessageClient) => void,
    private readonly surEtat: (e: EtatLien) => void,
  ) {}

  demarrer(): void {
    this.arrete = false;
    this.connecter();
  }

  arreter(): void {
    this.arrete = true;
    this.ws?.close();
  }

  private connecter(): void {
    this.surEtat('connexion');
    const ws = new WebSocket(this.url, ['ccremote', this.jeton]);
    this.ws = ws;
    ws.onopen = () => {
      this.attenteMs = 1_000;
      this.surEtat('ouvert');
    };
    ws.onmessage = (e) => {
      try {
        this.surMessage(JSON.parse(String(e.data)) as MessageClient); // émis par le relais selon le même contrat
      } catch (erreur) {
        journal.warn({ erreur: String(erreur) }, 'message du flux illisible');
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.surEtat('coupe');
      if (this.arrete) return;
      setTimeout(() => this.connecter(), this.attenteMs);
      this.attenteMs = Math.min(this.attenteMs * 2, 20_000);
    };
  }
}
