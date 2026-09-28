// Responsabilité : pousser en direct ce qui change vers les clients (web en WebSocket, iPhone en long-poll).
import type { ServerWebSocket } from 'bun';
import type { ResumeSession } from '../../commun/session.ts';
import type { EvenementDate, FicheMachine, Notification } from '../registre/registre.ts';

export type VueMachine = FicheMachine & { readonly enLigne: boolean };

export type MessageClient =
  | { readonly type: 'evenement'; readonly evenement: EvenementDate }
  | { readonly type: 'session'; readonly session: ResumeSession }
  | { readonly type: 'machine'; readonly machine: VueMachine }
  | { readonly type: 'flux'; readonly sessionId: string; readonly texte: string }
  | { readonly type: 'notification'; readonly notification: Notification };

export class Diffusion {
  private readonly clients = new Set<ServerWebSocket<unknown>>();
  private attentes = new Set<() => void>();

  ajouter(ws: ServerWebSocket<unknown>): void {
    this.clients.add(ws);
  }

  retirer(ws: ServerWebSocket<unknown>): void {
    this.clients.delete(ws);
  }

  diffuser(m: MessageClient): void {
    const texte = JSON.stringify(m);
    for (const ws of this.clients) ws.send(texte);
    if (m.type === 'flux') return;
    const reveils = this.attentes;
    this.attentes = new Set();
    for (const r of reveils) r();
  }

  // Long-poll : rend la main au prochain changement durable, ou à l'échéance.
  attendre(ms: number): Promise<void> {
    return new Promise((resoudre) => {
      const reveil = (): void => {
        clearTimeout(minuteur);
        resoudre();
      };
      const minuteur = setTimeout(() => {
        this.attentes.delete(reveil);
        resoudre();
      }, ms);
      this.attentes.add(reveil);
    });
  }
}
