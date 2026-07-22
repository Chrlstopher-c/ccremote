/**
 * Responsabilité : liaison réseau RÉELLE du canal de contrôle Pi→PC (D.3),
 * côté PC. `CanalControle` (superviseur/canal-controle.ts) existe depuis M-13
 * mais n'était jusqu'ici instancié que dans ses propres tests — aucun site de
 * production ne le rendait joignable depuis le Pi. Ce fichier ferme cet écart :
 * un serveur WebSocket qui désérialise une `RequeteControle` JSON par message
 * et lui fait traverser `CanalControle.traiter()`, sans aucune logique propre.
 *
 * `☠` Respecte D.3.2 à la lettre : ce serveur ne fait jamais d'appel sortant
 * vers le Pi — il ne fait que RÉPONDRE à une connexion entrante. Distinct du
 * canal de données D.1 (`transport/lien-websocket.ts`, trames binaires d'un
 * worker) : protocole JSON simple, dédié au contrôle.
 */

import type { ServerWebSocket } from 'bun';
import { CanalControle, type OptionsCanalControle, type PortSuperviseurControle, type RequeteControle } from '../../superviseur/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'serveur-controle-pc' });

export interface OptionsServeurControlePc {
  readonly port: number;
  readonly hostname?: string;
  readonly canalControle?: OptionsCanalControle;
}

export interface ServeurControlePc {
  readonly canal: CanalControle;
  readonly server: ReturnType<typeof Bun.serve>;
  arreter(): void;
}

function traiterMessage(canal: CanalControle, ws: ServerWebSocket<unknown>, data: string | Buffer): void {
  let requete: RequeteControle;
  try {
    requete = JSON.parse(String(data)) as RequeteControle;
  } catch (erreur) {
    log.error({ err: erreur }, 'requête de contrôle illisible — connexion ignorée, pas de crash du serveur');
    ws.send(JSON.stringify({ ok: false, effet: 'refuse', detail: 'JSON invalide' }));
    return;
  }
  canal
    .traiter(requete)
    .then((reponse) => ws.send(JSON.stringify(reponse)))
    .catch((erreur: unknown) => {
      log.error({ err: erreur, opId: requete.opId }, 'traitement de la requête de contrôle en échec inattendu');
      ws.send(JSON.stringify({ ok: false, effet: 'refuse', detail: 'échec inattendu côté PC' }));
    });
}

/**
 * Démarre le serveur. `superviseur` est le port réel (`SuperviseurWorkers`) —
 * voir `assembler-superviseur.ts` pour sa construction complète.
 */
export function demarrerServeurControlePc(
  superviseur: PortSuperviseurControle,
  options: OptionsServeurControlePc,
): ServeurControlePc {
  const canal = new CanalControle(superviseur, options.canalControle);
  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname,
    fetch(req, srv): Response | undefined {
      if (srv.upgrade(req)) return undefined;
      return new Response('canal de contrôle : WebSocket uniquement', { status: 400 });
    },
    websocket: {
      open(): void {
        log.info({}, 'connexion entrante sur le canal de contrôle (D.3)');
      },
      message(ws, data): void {
        traiterMessage(canal, ws, data);
      },
      close(): void {
        log.info({}, 'connexion fermée sur le canal de contrôle (D.3)');
      },
    },
  });
  log.info({ port: options.port }, 'serveur de contrôle PC démarré');
  return {
    canal,
    server,
    arreter: (): void => void server.stop(true),
  };
}
