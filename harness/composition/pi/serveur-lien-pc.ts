/**
 * Responsabilité : point d'écoute RÉEL du lien Pi↔PC (H-75), côté Pi.
 * Inversion de `composition/pc/serveur-controle.ts` (l'existant à inverser,
 * voir le mandat) : c'est maintenant le Pi qui héberge — joignable
 * publiquement via Cloudflare Tunnel — et le PC qui initie
 * (`composition/pc/client-lien-pi.ts`).
 *
 * `☠` Authentification (H-75, point 2) : le secret est vérifié APRÈS upgrade
 * WS, dans `open()`, jamais avant. Refuser au niveau HTTP (avant upgrade)
 * produirait côté PC un événement `error` générique — `LienWebSocket` le
 * traite comme un échec de connexion RETENTÉ avec backoff, pas comme une
 * fermeture terminale (`transport/lien-websocket.ts#tenterConnexion`). En
 * fermant APRÈS upgrade avec le code WS 4401 (plage D.2.1), le PC reçoit une
 * vraie fermeture terminale, classée par sa propre taxonomie, PAS retentée en
 * boucle par le transport — exactement l'exigence du mandat.
 *
 * `☠ V2 (2026-08-01) — PLUSIEURS MACHINES DE TRAVAIL`. La V1 ne tenait qu'un
 * seul emplacement : toute connexion authentifiée évinçait la précédente, d'où
 * qu'elle vienne. Cohabiter était donc structurellement impossible, et deux
 * superviseurs simultanés se chassaient en boucle (dette n°6, 1268 évictions
 * mesurées le 22/07). Chaque connexion s'annonce désormais avec une IDENTITÉ
 * (`lien-pc-pi/identite-machine.ts`), et le parc tient un lien PAR machine
 * (`parc-liens-machines.ts`) : le supersede ne joue plus qu'à identité ÉGALE —
 * deux process d'une même machine, c'est-à-dire une reprise après crash.
 *
 * `☠` Identité absente ou malformée ⇒ connexion REFUSÉE (4403, terminal). Un
 * repli du genre « anonyme » ferait cohabiter deux machines sous un même nom et
 * ramènerait la tempête sans qu'on la voie. Conséquence de déploiement, à
 * respecter : déployer d'abord les MACHINES DE TRAVAIL (le client envoie
 * l'en-tête, un Pi ancien l'ignore), le Pi ensuite. L'ordre inverse refuse tous
 * les clients anciens jusqu'à leur mise à jour — bruyamment, mais réellement.
 *
 * Réutilise `LienWebSocket` SYMÉTRIQUEMENT (voir `DECISION-TRANSPORT.md`,
 * tête de fichier de `lien-websocket.ts`) : sur ce process, `connecter()` ne
 * compose pas une connexion sortante, il ATTEND la prochaine connexion
 * entrante authentifiée — le même mécanisme de reprise (backoff, ping/pong,
 * rejeu du non-acquitté) s'applique alors identiquement des deux côtés.
 *
 * `☠ TROUVÉ EN ASSEMBLANT` — `modeIntegrite: 'perte_silencieuse'` est un choix
 * délibéré, pas l'oubli du défaut `'strict'`. `#distribuer` (`transport/
 * lien-websocket.ts`, hors zone) ne câble la RÉCEPTION que de `TAG.STDOUT` ;
 * `versPc()` (`TAG.STDIN`) n'a aucun chemin de réception (voir
 * `composition/pi/client-superviseur-pc.ts`, même en-tête, pour le détail).
 * Ce lien n'utilise donc QUE `versPi()` dans les deux sens, ce qui prive les
 * enveloppes de `lien-pc-pi/protocole.ts` du rejeu au rattachement (`#stdin`
 * seul est rejoué par `#tenterConnexion`, jamais `#stdout`). En mode
 * `'strict'` (le défaut), un octet perdu pendant une coupure ferait LEVER
 * `ErreurIntegriteTuyau` au prochain message reçu — non rattrapée dans
 * `#surMessage`, donc potentiellement fatale au process. Nos enveloppes sont
 * déjà idempotentes/retentables au niveau applicatif (opId de `CanalControle`,
 * repli deny-par-timeout du bus de permissions) : tolérer un trou de séquence
 * plutôt que planter est le choix correct ICI — ça ne le serait PAS pour le
 * canal principal D.1 (octets SDK bruts, jamais rejouables applicativement).
 */

import type { Server, ServerWebSocket } from 'bun';
import type { LienWebSocket, WebSocketLike } from '../../transport/lien-websocket.ts';
import type { HorlogeTransport } from '../../transport/horloge-transport.ts';
import { compositionLogger } from '../logger.ts';
import { extraireSecret, secretValide } from '../lien-pc-pi/secret.ts';
import { extraireMachineId } from '../lien-pc-pi/identite-machine.ts';
import { ParcLiensMachines, type EtatMachineLien } from './parc-liens-machines.ts';

const log = compositionLogger.child({ composant: 'serveur-lien-pc' });

/**
 * `☠` Code de fermeture 4403 (« rejet permanent » dans la taxonomie du
 * transport, `transport/lien-websocket.ts`) pour une identité absente ou
 * malformée. Un code hors table serait classé INCONNU, donc TRANSITOIRE, donc
 * retenté sans fin par le client : le refus deviendrait un martèlement muet.
 * On n'invente pas de code — on réutilise celui que la taxonomie sait classer.
 */
const CODE_IDENTITE_REFUSEE = 4403;

interface DonneesWs {
  readonly authentifie: boolean;
  /** `null` ⇒ client trop ancien ou identité malformée : refus terminal. */
  readonly machineId: string | null;
}

type Ecouteur<T> = (ev: T) => void;

/** Adapte `ServerWebSocket<DonneesWs>` (callbacks globaux Bun.serve) en `WebSocketLike` (par connexion). */
class AdaptateurServerWebSocket implements WebSocketLike {
  readonly #message: Ecouteur<{ data: unknown }>[] = [];
  readonly #close: Ecouteur<{ code: number; reason: string }>[] = [];
  readonly #error: Ecouteur<unknown>[] = [];

  constructor(private readonly ws: ServerWebSocket<DonneesWs>) {}

  get readyState(): number {
    return this.ws.readyState;
  }

  send(data: Uint8Array): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  addEventListener(
    type: 'message' | 'close' | 'error',
    listener: Ecouteur<{ data: unknown }> | Ecouteur<{ code: number; reason: string }> | Ecouteur<unknown>,
  ): void {
    if (type === 'message') this.#message.push(listener as Ecouteur<{ data: unknown }>);
    else if (type === 'close') this.#close.push(listener as Ecouteur<{ code: number; reason: string }>);
    else this.#error.push(listener as Ecouteur<unknown>);
  }

  /** Poussé par les handlers globaux `Bun.serve({ websocket })` ci-dessous. */
  distribuerMessage(data: unknown): void {
    for (const l of this.#message) l({ data });
  }

  distribuerFermeture(code: number, reason: string): void {
    for (const l of this.#close) l({ code, reason });
  }
}

export interface OptionsServeurLienPc {
  readonly port: number;
  readonly hostname?: string;
  readonly secret: string;
  readonly horloge?: HorlogeTransport;
  /**
   * Appelé à chaque connexion authentifiée acceptée, AVEC l'identité de la
   * machine (H-75 : point d'accroche de la réconciliation sur rattachement).
   * `☠` L'identité est ici obligatoire : réconcilier « le PC » sans savoir
   * lequel marquerait fantômes les missions de toutes les autres machines.
   */
  readonly surConnexionAcceptee?: (machineId: string) => void;
  /** Voir `OptionsParcLiensMachines.surNouvelleMachine` — synchrone, avant rattachement. */
  readonly surNouvelleMachine?: (machineId: string, lien: LienWebSocket) => void;
}

export interface ServeurLienPc {
  /** Le lien d'une machine donnée, ou `null` si elle ne s'est jamais présentée. */
  lienPour(machineId: string): LienWebSocket | null;
  /** Toutes les machines connues depuis le démarrage, en ligne ou non (H-75). */
  machines(): readonly EtatMachineLien[];
  machinesEnLigne(): readonly string[];
  /** Port réellement écouté — utile quand `options.port` vaut 0 (attribution noyau). */
  readonly port: number;
  /**
   * Nombre d'évictions réelles. `☠` Depuis la V2, une éviction ne peut plus
   * venir que d'un DOUBLON DE PROCESS SUR UNE MÊME MACHINE — deux machines
   * distinctes cohabitent. Doit rester à 0 en exploitation nominale, y compris
   * après une nuit d'extinction : c'est ce qui distingue une reconnexion
   * légitime d'un vrai doublon. Exposé pour être observable côté control plane,
   * pas seulement journalisé.
   */
  supersedes(): number;
  arreter(): void;
}

/** Marge d'attente de l'ouverture effective du lien après acceptation. */
const ATTENTE_OUVERTURE_MS = 2_000;
const PAS_ATTENTE_MS = 20;

/**
 * Attend que `LienWebSocket` ait RÉELLEMENT branché la socket. Bornée : plutôt
 * renoncer bruyamment que boucler pour toujours si le lien ne s'ouvre pas.
 */
async function attendreLienOuvert(lien: LienWebSocket): Promise<boolean> {
  const echeance = Date.now() + ATTENTE_OUVERTURE_MS;
  while (Date.now() < echeance) {
    if (lien.etat() === 'ouvert') return true;
    await new Promise((r) => setTimeout(r, PAS_ATTENTE_MS));
  }
  return lien.etat() === 'ouvert';
}

/**
 * Démarre le point d'écoute Pi et construit UN `LienWebSocket` symétrique PAR
 * MACHINE identifiée (voir `parc-liens-machines.ts`).
 * `☠` Ne jamais journaliser `req.url` en clair (l'URL ne porte plus le secret,
 * mais rien ne garantit qu'un paramètre sensible ne s'y glissera pas).
 */
export function demarrerServeurLienPc(options: OptionsServeurLienPc): ServeurLienPc {
  const parc = new ParcLiensMachines({
    horloge: options.horloge,
    surNouvelleMachine: options.surNouvelleMachine,
  });
  // Association ws réel ⇒ adaptateur : `ws.data` est figé à l'upgrade — pas
  // d'endroit propre où loger l'adaptateur dessus sans le muter. Une Map évite
  // ce contournement.
  const adaptateurs = new WeakMap<ServerWebSocket<DonneesWs>, AdaptateurServerWebSocket>();

  const server: Server<DonneesWs> = Bun.serve<DonneesWs>({
    port: options.port,
    hostname: options.hostname,
    fetch(req, srv): Response | undefined {
      const authentifie = secretValide(extraireSecret(req), options.secret);
      // `☠` L'identité est lue ICI, à l'upgrade, et figée dans `ws.data` : c'est
      // le seul instant où la requête HTTP existe encore. La relire plus tard
      // serait impossible — et la déduire serait pire.
      const machineId = extraireMachineId(req);
      if (srv.upgrade(req, { data: { authentifie, machineId } })) return undefined;
      return new Response('lien Pi↔machine de travail : WebSocket uniquement', { status: 400 });
    },
    websocket: {
      open(ws): void {
        if (!ws.data.authentifie) {
          log.error({}, 'connexion refusée — secret absent ou invalide (fermeture terminale 4401, D.2.1)');
          ws.close(4401, 'authentification refusée');
          return;
        }
        const machineId = ws.data.machineId;
        if (machineId === null) {
          // `☠` Jamais d'identité de repli. Deux machines sous un même nom
          // rétabliraient la tempête d'évictions en la rendant invisible.
          log.error(
            {},
            'connexion refusée — identité de machine absente ou invalide (en-tête x-ccremote-machine). Client trop ancien ? Fermeture terminale 4403',
          );
          ws.close(CODE_IDENTITE_REFUSEE, 'identité de machine absente ou invalide');
          return;
        }
        const adaptateur = new AdaptateurServerWebSocket(ws);
        adaptateurs.set(ws, adaptateur);
        parc.accepter(machineId, adaptateur);
        log.info({ machineId }, 'connexion authentifiée acceptée');
        const lien = parc.lienPour(machineId);
        // `☠ TROUVÉ EN PRODUCTION (2026-07-22)` — ce rappel ne doit PAS partir
        // ici. `accepter()` résout la promesse de `connecter()`, mais
        // `LienWebSocket` ne branche réellement la socket qu'à la reprise de son
        // `await`, donc APRÈS ce bloc synchrone. Appelé tout de suite, le
        // déclencheur lançait la réconciliation sur un lien dont `#ws` valait
        // encore `null` : chaque requête d'inventaire était abandonnée en
        // silence par `#envoyer`, et le corrélateur expirait 10 s plus tard.
        // Déterministe, à chaque rattachement — invisible en local parce que
        // rien n'avait jamais émis de requête de contrôle en réel.
        if (lien === null) return;
        void attendreLienOuvert(lien).then((ouvert) => {
          if (!ouvert) {
            log.error(
              { machineId },
              'lien toujours pas ouvert après acceptation — réconciliation NON déclenchée (jamais en silence)',
            );
            return;
          }
          options.surConnexionAcceptee?.(machineId);
        });
      },
      message(ws, data): void {
        adaptateurs.get(ws)?.distribuerMessage(data);
      },
      close(ws, code, reason): void {
        const adaptateur = adaptateurs.get(ws);
        if (adaptateur === undefined) return;
        // Oublier AVANT de distribuer : `distribuerFermeture` réveille
        // `LienWebSocket`, qui replanifie une reconnexion et peut rappeler
        // `connecter()` — la file doit déjà être propre à cet instant.
        if (ws.data.machineId !== null) parc.oublier(ws.data.machineId, adaptateur);
        adaptateur.distribuerFermeture(code, reason);
      },
    },
  });

  // Le port RÉELLEMENT écouté, jamais celui demandé : avec `port: 0` (banc),
  // journaliser la demande ne dit rien d'où joindre le serveur. `undefined`
  // n'arrive que sur socket UNIX — impossible ici, et si ça arrivait un jour ce
  // serait un échec bruyant plutôt qu'un 0 trompeur (H-74, point 2).
  const portEcoute = server.port;
  if (portEcoute === undefined) throw new Error('serveur de lien Pi↔PC démarré sans port TCP — configuration inattendue');
  log.info(
    { port: portEcoute, hostname: options.hostname },
    'serveur de lien Pi↔machines démarré (H-75 — le Pi héberge, les machines de travail initient)',
  );

  return {
    lienPour: (machineId): LienWebSocket | null => parc.lienPour(machineId),
    machines: (): readonly EtatMachineLien[] => parc.machines(),
    machinesEnLigne: (): readonly string[] => parc.machinesEnLigne(),
    port: portEcoute,
    supersedes: (): number => parc.supersedes(),
    arreter: (): void => {
      parc.fermer();
      server.stop(true);
    },
  };
}
