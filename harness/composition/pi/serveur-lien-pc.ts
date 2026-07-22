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
 * `☠` V1 — un seul PC (H-56 : une mission active par projet ne change rien à
 * ça, c'est structurel). Une nouvelle connexion authentifiée alors qu'une
 * précédente est vivante est traitée comme un remplacement (supersede) : la
 * plus récente gagne, l'ancienne est fermée (code 1000, non taxonomique) —
 * ce qui déclenche côté PC le chemin de reprise TRANSITOIRE déjà existant de
 * `LienWebSocket`, jamais un second mécanisme.
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
import { LienWebSocket, type WebSocketLike } from '../../transport/lien-websocket.ts';
import type { HorlogeTransport } from '../../transport/horloge-transport.ts';
import { compositionLogger } from '../logger.ts';
import { extraireSecret, secretValide } from '../lien-pc-pi/secret.ts';

const log = compositionLogger.child({ composant: 'serveur-lien-pc' });

interface DonneesWs {
  readonly authentifie: boolean;
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
  /** Appelé à chaque connexion PC authentifiée acceptée (H-75 : point d'accroche de la réconciliation sur rattachement). */
  readonly surConnexionAcceptee?: () => void;
}

export interface ServeurLienPc {
  readonly lien: LienWebSocket;
  /** Port réellement écouté — utile quand `options.port` vaut 0 (attribution noyau). */
  readonly port: number;
  /**
   * Nombre d'évictions réelles (deux PC connectés en même temps). Doit rester à
   * 0 en exploitation nominale, y compris après une nuit d'extinction du PC :
   * c'est ce qui distingue une reconnexion légitime d'un vrai doublon. Exposé
   * pour être observable côté control plane, pas seulement journalisé.
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

/** File à un seul emplacement (v1, un seul PC) : la connexion la plus récente non encore consommée. */
class FileConnexionUnique {
  #enFile: AdaptateurServerWebSocket | null = null;
  #enAttente: ((ws: WebSocketLike) => void) | null = null;
  #actif: AdaptateurServerWebSocket | null = null;
  #supersedes = 0;

  get supersedes(): number {
    return this.#supersedes;
  }

  /**
   * `☠ TROUVÉ EN RELECTURE (2026-07-22)` — sans cet oubli explicite, `#actif`
   * gardait éternellement la connexion de la veille. Conséquence sur LE
   * scénario nominal (« j'éteins le PC le soir, je le rallume le lendemain,
   * tout se reconnecte tout seul ») : chaque reconnexion légitime du matin
   * était journalisée en `warn` comme un supersede, et fermait une socket déjà
   * morte. Mesuré : re-fermer une socket close est un no-op en Bun, donc la
   * reconnexion fonctionnait — mais l'alarme « deux PC connectés » se
   * déclenchait tous les matins, ce qui la rend invisible le jour où elle est
   * vraie. Un garde-fou qui crie tout le temps ne garde plus rien.
   */
  oublier(adaptateur: AdaptateurServerWebSocket): void {
    if (this.#actif === adaptateur) this.#actif = null;
    if (this.#enFile === adaptateur) this.#enFile = null;
  }

  /** Accepte une connexion authentifiée. Évince l'actif s'il y en a un (supersede). */
  accepter(adaptateur: AdaptateurServerWebSocket): void {
    if (this.#actif !== null) {
      this.#supersedes += 1;
      log.warn({}, 'nouvelle connexion PC authentifiée alors qu une précédente est vivante — supersede (v1, un seul PC)');
      this.#actif.close(1000, 'remplacée par une connexion plus récente');
    }
    if (this.#enAttente !== null) {
      const resolveur = this.#enAttente;
      this.#enAttente = null;
      this.#actif = adaptateur;
      resolveur(adaptateur);
      return;
    }
    this.#enFile = adaptateur;
    this.#actif = adaptateur;
  }

  /** Le `ConnecteurWebSocket` fourni à `LienWebSocket` — attend la prochaine connexion. */
  connecter(): Promise<WebSocketLike> {
    return new Promise((resolve) => {
      if (this.#enFile !== null) {
        const ws = this.#enFile;
        this.#enFile = null;
        resolve(ws);
        return;
      }
      this.#enAttente = resolve;
    });
  }
}

/**
 * Démarre le point d'écoute Pi et construit le `LienWebSocket` symétrique par-dessus.
 * `☠` Ne jamais journaliser `req.url` en clair (porte le secret, `?secret=…`).
 */
export function demarrerServeurLienPc(options: OptionsServeurLienPc): ServeurLienPc {
  const file = new FileConnexionUnique();
  // Association ws réel ⇒ adaptateur : `ws.data` est figé à l'upgrade (typé
  // `DonneesWs`, `authentifie` seulement) — pas d'endroit propre où loger
  // l'adaptateur dessus sans le muter. Une Map évite ce contournement.
  const adaptateurs = new WeakMap<ServerWebSocket<DonneesWs>, AdaptateurServerWebSocket>();

  const lien = new LienWebSocket({
    connecter: () => file.connecter(),
    horloge: options.horloge,
    modeIntegrite: 'perte_silencieuse',
  });

  const server: Server<DonneesWs> = Bun.serve<DonneesWs>({
    port: options.port,
    hostname: options.hostname,
    fetch(req, srv): Response | undefined {
      const authentifie = secretValide(extraireSecret(req), options.secret);
      if (srv.upgrade(req, { data: { authentifie } })) return undefined;
      return new Response('lien Pi↔PC : WebSocket uniquement', { status: 400 });
    },
    websocket: {
      open(ws): void {
        if (!ws.data.authentifie) {
          log.error({}, 'connexion PC refusée — secret absent ou invalide (fermeture terminale 4401, D.2.1)');
          ws.close(4401, 'authentification refusée');
          return;
        }
        const adaptateur = new AdaptateurServerWebSocket(ws);
        adaptateurs.set(ws, adaptateur);
        file.accepter(adaptateur);
        log.info({}, 'connexion PC authentifiée acceptée');
        // `☠ TROUVÉ EN PRODUCTION (2026-07-22)` — ce rappel ne doit PAS partir
        // ici. `file.accepter()` résout la promesse de `connecter()`, mais
        // `LienWebSocket` ne branche réellement la socket qu'à la reprise de son
        // `await`, donc APRÈS ce bloc synchrone. Appelé tout de suite, le
        // déclencheur lançait la réconciliation sur un lien dont `#ws` valait
        // encore `null` : chaque requête d'inventaire était abandonnée en
        // silence par `#envoyer`, et le corrélateur expirait 10 s plus tard.
        // Déterministe, à chaque rattachement — invisible en local parce que
        // rien n'avait jamais émis de requête de contrôle en réel.
        void attendreLienOuvert(lien).then((ouvert) => {
          if (!ouvert) {
            log.error({}, 'lien toujours pas ouvert après acceptation — réconciliation NON déclenchée (jamais en silence)');
            return;
          }
          options.surConnexionAcceptee?.();
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
        file.oublier(adaptateur);
        adaptateur.distribuerFermeture(code, reason);
      },
    },
  });

  void lien.connecter();
  // Le port RÉELLEMENT écouté, jamais celui demandé : avec `port: 0` (banc),
  // journaliser la demande ne dit rien d'où joindre le serveur. `undefined`
  // n'arrive que sur socket UNIX — impossible ici, et si ça arrivait un jour ce
  // serait un échec bruyant plutôt qu'un 0 trompeur (H-74, point 2).
  const portEcoute = server.port;
  if (portEcoute === undefined) throw new Error('serveur de lien Pi↔PC démarré sans port TCP — configuration inattendue');
  log.info({ port: portEcoute, hostname: options.hostname }, 'serveur de lien Pi↔PC démarré (H-75 — le Pi héberge, le PC initie)');

  return {
    lien,
    port: portEcoute,
    supersedes: (): number => file.supersedes,
    arreter: (): void => {
      lien.fermer();
      server.stop(true);
    },
  };
}
