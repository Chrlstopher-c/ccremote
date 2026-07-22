/**
 * Responsabilité : client RÉEL du canal de contrôle Pi→PC (D.3), côté Pi.
 * Implémente les ports attendus par la réconciliation (`InventairePc`,
 * `ReinitialisateurSession`, `control-plane/reconciliation/types.ts`, M-30)
 * et par le serveur MCP de contrôle (`ArreteurMission`, `RelanceurMission`,
 * `mcp-controle/types.ts`, A.2) — les cinq derniers étaient jusqu'ici des
 * contrats sans aucune implémentation réseau (TODO.md, « Ports non
 * implémentés »).
 *
 * `☠` Le Pi INITIE toujours ces appels (D.3.2 : « le PC n'initie jamais ») —
 * ce client en est la preuve mécanique : `PortSuperviseurControle` côté PC
 * n'a aucune référence sortante, seul ce fichier ouvre une connexion.
 *
 * `⚠` Limite assumée, documentée plutôt que masquée : `ReponseControle`
 * (superviseur/canal-controle.ts) ne porte pas l'`opId` de la requête qu'elle
 * clôt. Sur une connexion WebSocket unique, deux appels concurrents ne
 * pourraient donc pas être appariés à leur réponse — ce client SÉRIALISE
 * les appels (un seul en vol à la fois) pour rester correct sans modifier le
 * contrat de `canal-controle.ts` (hors zone de cette mission). Un deuxième
 * client (ou un pool) reste la voie si le débit devient un problème réel.
 */

import { randomUUID } from 'node:crypto';
import type {
  DemandeEnAttenteReinitialisation,
  DescripteurWorkerPc,
  InventairePc,
  ReinitialisateurSession,
  ResultatReinitialisation,
} from '../../control-plane/reconciliation/index.ts';
import type { ArreteurMission, RelanceurMission } from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import type { OperationControle, ReponseControle } from '../../superviseur/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'client-superviseur-pc' });

export class ErreurClientSuperviseurPc extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurClientSuperviseurPc';
  }
}

export interface OptionsClientSuperviseurPc {
  readonly url: string;
  readonly timeoutMs?: number;
}

const TIMEOUT_MS_DEFAUT = 10_000;

/**
 * Un appel = ouvrir, envoyer, attendre LA prochaine trame, fermer. Pas de
 * connexion longue vie : plus simple à raisonner pour un premier câblage
 * réel, au prix d'une reconnexion par appel (acceptable sur LAN de confiance,
 * H-03 — à revoir si la fréquence d'appel devient un problème mesuré).
 */
function appellerCanalControle(
  url: string,
  operation: OperationControle,
  timeoutMs: number,
): Promise<ReponseControle> {
  const opId = randomUUID();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const minuteur = setTimeout(() => {
      ws.close();
      reject(new ErreurClientSuperviseurPc(`délai dépassé (${String(timeoutMs)} ms) sur l'opération « ${operation.type} »`));
    }, timeoutMs);

    ws.addEventListener('open', () => ws.send(JSON.stringify({ opId, operation })));
    ws.addEventListener('message', (event) => {
      clearTimeout(minuteur);
      ws.close();
      try {
        resolve(JSON.parse(String(event.data)) as ReponseControle);
      } catch (erreur) {
        reject(new ErreurClientSuperviseurPc(`réponse illisible du PC : ${String(erreur)}`));
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(minuteur);
      reject(new ErreurClientSuperviseurPc(`connexion au PC en échec (${url})`));
    });
  });
}

function versDescripteurs(reponse: ReponseControle): readonly DescripteurWorkerPc[] {
  return reponse.inventaire ?? [];
}

function versDemandesEnAttente(reponse: ReponseControle): readonly DemandeEnAttenteReinitialisation[] {
  return reponse.demandesEnAttente ?? [];
}

/**
 * Implémente structurellement `InventairePc & ReinitialisateurSession &
 * ArreteurMission & RelanceurMission` — un seul client réseau pour les
 * quatre ports, puisque les quatre traversent le même canal D.3.
 */
export class ClientSuperviseurPc implements InventairePc, ReinitialisateurSession, ArreteurMission, RelanceurMission {
  readonly #url: string;
  readonly #timeoutMs: number;

  constructor(options: OptionsClientSuperviseurPc) {
    this.#url = options.url;
    this.#timeoutMs = options.timeoutMs ?? TIMEOUT_MS_DEFAUT;
  }

  async inventaire(): Promise<readonly DescripteurWorkerPc[]> {
    try {
      const reponse = await appellerCanalControle(this.#url, { type: 'inventaire' }, this.#timeoutMs);
      return versDescripteurs(reponse);
    } catch (erreur) {
      log.error({ err: erreur }, "inventaire() du PC injoignable — traité comme vide, jamais comme une exception qui bloque la réconciliation");
      return [];
    }
  }

  async tuerSansPreavis(sessionId: string): Promise<void> {
    await appellerCanalControle(this.#url, { type: 'tuer_sans_preavis', sessionId }, this.#timeoutMs);
  }

  async reinitialiser(sessionId: string): Promise<ResultatReinitialisation> {
    const reponse = await appellerCanalControle(this.#url, { type: 'reinitialiser', sessionId }, this.#timeoutMs);
    return { demandesEnAttente: versDemandesEnAttente(reponse) };
  }

  async arreter(missionId: string): Promise<void> {
    await appellerCanalControle(this.#url, { type: 'arreter_worker', missionId }, this.#timeoutMs);
  }

  async relancer(missionId: string, sessionId: string): Promise<void> {
    await appellerCanalControle(this.#url, { type: 'relancer_worker', missionId, sessionId }, this.#timeoutMs);
  }
}
