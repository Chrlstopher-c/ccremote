// Responsabilité : pousser en direct ce qui change vers les clients (web en WebSocket, iPhone en long-poll).
import type { ServerWebSocket } from 'bun';
import type { MessageClient, VueMachine } from '../../commun/api-clients.ts';

export type { MessageClient, VueMachine };

export class Diffusion {
  private readonly clients = new Set<ServerWebSocket<unknown>>();
  private attentes = new Set<() => void>();
  // Écouteurs internes (mode duo) : voient chaque message diffusé, sans passer par les clients.
  private readonly ecouteurs = new Set<(m: MessageClient) => void>();
  // N'avance que sur un changement utile (session, fil, notification), pas sur l'état machine.
  private versionCourante = 0;

  get version(): number {
    return this.versionCourante;
  }

  /** Nombre d'applis connectées en WebSocket (un appel de module n'a de sens que s'il y en a une). */
  get nombreApplis(): number {
    return this.clients.size;
  }

  /** Abonne un écouteur interne ; rend la fonction qui le retire. */
  ecouter(fn: (m: MessageClient) => void): () => void {
    this.ecouteurs.add(fn);
    return () => void this.ecouteurs.delete(fn);
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
    for (const ecouteur of this.ecouteurs) ecouteur(m);
    // L'iPhone ne se réveille ni pour chaque fragment d'Echo ni pour la salle de réunion (HQ, WebSocket seulement),
    // ni pour chaque delta de texte (le bloc final réveille le long-poll).
    if (['machine', 'echo', 'reunion', 'flux', 'module_appel'].includes(m.type)) return;
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
