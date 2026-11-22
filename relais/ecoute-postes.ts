// Responsabilité : l'écoute des postes — le WebSocket par lequel chaque machine du parc garde son lien avec
// le relais. Le secret est vérifié à la poignée (401 sinon) ; ouverture, réception et fermeture sont
// confiées au parc (`Postes`).
import type { Logger } from 'pino';
import type { Server, ServerWebSocket } from 'bun';
import { CHEMIN_POSTE } from '../commun/protocole-poste.ts';
import type { EcoutePostes } from './config.ts';
import type { DonneesPoste, Postes } from './parc/postes.ts';

export interface DependancesEcoutePostes {
  readonly ecoute: readonly EcoutePostes[];
  readonly postes: Pick<Postes, 'authentifier' | 'ouvert' | 'ferme' | 'recu'>;
  readonly journal: Logger;
}

/** Ouvre une écoute par adresse configurée ; chaque connexion d'un poste passe par `Postes`. */
export function demarrerEcoutePostes(d: DependancesEcoutePostes): void {
  for (const { hote, port } of d.ecoute) {
    Bun.serve<DonneesPoste>({
      hostname: hote,
      port,
      fetch: (req: Request, serveur: Server<DonneesPoste>) => reponsePoste(req, serveur, d),
      websocket: {
        data: {} as DonneesPoste,
        open: (ws: ServerWebSocket<DonneesPoste>) => d.postes.ouvert(ws),
        close: (ws: ServerWebSocket<DonneesPoste>) => d.postes.ferme(ws),
        message: (ws: ServerWebSocket<DonneesPoste>, m: string | Buffer) => d.postes.recu(ws, String(m)),
        idleTimeout: 120,
        sendPings: true,
        maxPayloadLength: 64 * 1024 * 1024, // un module de 20 Mo part en base64 (~27 Mo) dans un seul message (v1.2)
      },
    });
  }
}

// La poignée : le bon chemin, un secret valide, puis le passage en WebSocket ; sinon la réponse qui refuse.
function reponsePoste(req: Request, serveur: Server<DonneesPoste>, d: DependancesEcoutePostes): Response | undefined {
  if (new URL(req.url).pathname !== CHEMIN_POSTE) return new Response('introuvable', { status: 404 });
  const machine = d.postes.authentifier(req);
  if (!machine) {
    d.journal.warn({ machine: req.headers.get('x-ccremote-machine') }, 'poste refusé : secret invalide');
    return new Response('refusé', { status: 401 });
  }
  return serveur.upgrade(req, { data: { machine } }) ? undefined : new Response('WebSocket attendu', { status: 426 });
}
