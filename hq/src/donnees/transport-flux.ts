// Responsabilité : le flux temps réel du relais (WebSocket) — authentification par sous-protocole, reconnexion avec
// backoff doublé et plafonné. Le jeton ne voyage jamais dans l'URL.
import type { MessageClient } from './contrat';
import { journaliser } from './journal';
import type { EcouteurSource } from './source-monde';

export const PROTOCOLE_FLUX = 'ccremote'; // même nom que le sous-protocole accepté par le relais
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 20_000;

export type FabriqueSocket = (url: string, protocoles: string[]) => WebSocket;
export type Programmateur = (fn: () => void, ms: number) => void;

export class FluxRelais {
  private socket: WebSocket | null = null;
  private attenteMs = BACKOFF_MIN_MS;
  private arrete = true;

  constructor(
    private readonly url: string,
    private readonly jeton: string,
    private readonly fabrique: FabriqueSocket,
    private readonly programmer: Programmateur,
  ) {}

  demarrer(ecouteur: EcouteurSource): void {
    this.arrete = false;
    this.connecter(ecouteur);
  }

  arreter(): void {
    this.arrete = true;
    this.socket?.close();
    this.socket = null;
  }

  private connecter(ecouteur: EcouteurSource): void {
    ecouteur.surLien('connexion');
    const ws = this.fabrique(this.url, [PROTOCOLE_FLUX, this.jeton]);
    this.socket = ws;
    ws.onopen = () => {
      this.attenteMs = BACKOFF_MIN_MS;
      ecouteur.surLien('ouvert');
    };
    ws.onmessage = (e: MessageEvent) => this.recevoir(e.data, ecouteur);
    ws.onerror = () => journaliser('warn', 'flux du relais en erreur');
    ws.onclose = () => this.fermer(ws, ecouteur);
  }

  private fermer(ws: WebSocket, ecouteur: EcouteurSource): void {
    if (this.socket === ws) this.socket = null;
    ecouteur.surLien('coupe');
    if (!this.arrete) this.reprogrammer(ecouteur);
  }

  private reprogrammer(ecouteur: EcouteurSource): void {
    const delai = this.attenteMs;
    this.attenteMs = Math.min(delai * 2, BACKOFF_MAX_MS);
    this.programmer(() => {
      if (!this.arrete) this.connecter(ecouteur);
    }, delai);
  }

  private recevoir(brut: unknown, ecouteur: EcouteurSource): void {
    let message: MessageClient;
    try {
      message = JSON.parse(String(brut)) as MessageClient; // forme garantie par le relais, miroir dans contrat.ts
    } catch (erreur) {
      journaliser('warn', 'message du flux illisible', { erreur: String(erreur) });
      return;
    }
    ecouteur.surMessage(message);
  }
}
