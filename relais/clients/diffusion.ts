// Responsabilité : pousser en direct ce qui change vers les clients (web en WebSocket, iPhone en long-poll).
import type { ServerWebSocket } from 'bun';
import type { MessageClient, VueMachine } from '../../commun/api-clients.ts';

export type { MessageClient, VueMachine };

export class Diffusion {
  private readonly clients = new Set<ServerWebSocket<unknown>>();
  private attentes = new Set<() => void>();
  private versionCourante = 0; // n'avance que sur un changement utile (session, fil, notification), pas sur l'état machine

  get version(): number {
    return this.versionCourante;
  }

  ajouter(ws: ServerWebSocket<unknown>): void {
    this.clients.add(ws);
  }

  retirer(ws: ServerWebSocket<unknown>): void {
    this.clients.delete(ws);
  }

  diffuser(m: MessageClient): void {
    const texte = JSON.stringify(m);
    for (const ws of this.clients) ws.send(texte);
    if (m.type === 'machine') return;
    this.versionCourante += 1;
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
