// Responsabilité : la source « relais » du monde — assemble le client HTTP et le flux temps réel derrière SourceMonde.
import { ClientRelais, type Recuperer } from './transport-http';
import { type FabriqueSocket, FluxRelais, type Programmateur } from './transport-flux';
import type { SourceMonde } from './source-monde';

export interface OptionsRelais {
  readonly base: string;
  readonly jeton: string;
  readonly recuperer?: Recuperer;
  readonly fabrique?: FabriqueSocket;
  readonly programmer?: Programmateur;
}

export function creerSourceRelais(options: OptionsRelais): SourceMonde {
  const base = options.base.replace(/\/+$/, '');
  const http = new ClientRelais(base, options.jeton, options.recuperer ?? versFetch);
  const flux = new FluxRelais(
    urlFlux(base),
    options.jeton,
    options.fabrique ?? versWebSocket,
    options.programmer ?? versDelai,
  );
  return {
    nom: 'relais',
    api: http,
    etatInitial: () => http.etat(),
    evenements: (sessionId) => http.evenements(sessionId),
    demarrer: (ecouteur) => flux.demarrer(ecouteur),
    arreter: () => flux.arreter(),
  };
}

export function urlFlux(base: string): string {
  return `${base.replace(/^http/, 'ws')}/api/flux`;
}

function versFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

function versWebSocket(url: string, protocoles: string[]): WebSocket {
  return new WebSocket(url, protocoles);
}

function versDelai(fn: () => void, ms: number): void {
  setTimeout(fn, ms);
}
