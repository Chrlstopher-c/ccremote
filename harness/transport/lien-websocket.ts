/**
 * Responsabilité : le lien Pi↔PC réel (D.1.2, D.1.3), au-dessus d'une seule
 * connexion WebSocket multiplexée par tag de trame (`trame.ts`).
 *
 * Décision de tunnel : voir `DECISION-TRANSPORT.md`. Résumé : WebSocket plutôt
 * que SSH, zéro dépendance ajoutée (`WebSocket` est natif à Bun), framing par
 * message déjà garanti par le protocole WS (pas de découpage de trame à gérer).
 *
 * `☠ CASSE` — D.2.1 : une coupure transitoire ne doit **jamais** atteindre
 * `surFermeture()`. Elle est absorbée ici, retentée indéfiniment avec un
 * backoff, et le canal de données rejoue ce qui n'a pas été acquitté. Seule
 * une fermeture dont le code appartient à la taxonomie (401/403/404/4090/
 * 4091/4092) est terminale et remonte.
 */

import { CanalDonnees } from './canal-donnees.ts';
import type {
  CanalControleProcessus,
  CodeFermeture,
  EtatLien,
  FermetureTerminale,
  Lien,
  ModeIntegrite,
  Tuyau,
} from './contrat.ts';
import { HORLOGE_REELLE, type HorlogeTransport } from './horloge-transport.ts';
import { transportLogger } from './logger.ts';
import { TAG, decoderExit, decoderTrame, decoderTexte, encoderTexte, encoderTrame, versUint8Array } from './trame.ts';

/** Sous-ensemble de l'API WebSocket (navigateur / Bun) réellement utilisé. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
}

const WS_OUVERT = 1;

export type ConnecteurWebSocket = () => Promise<WebSocketLike>;

/** Mappage des codes de fermeture applicatifs (plage WS 4000-4999 + repli HTTP-like). */
const CODES_WS_VERS_TAXONOMIE: Readonly<Record<number, CodeFermeture>> = {
  4401: 401,
  4403: 403,
  4404: 404,
  4090: 4090,
  4091: 4091,
  4092: 4092,
};

const RAISONS: Readonly<Record<CodeFermeture, string>> = {
  401: 'credential expiré — se rattacher avec un secret frais',
  403: 'rejet HTTP permanent',
  404: 'rejet HTTP permanent',
  4090: 'epoch dépassé — plus le worker actif',
  4091: "échec d'initialisation du client",
  4092: 'fermeture sans code — cause inconnue',
};

const BACKOFF_DEFAUT: readonly number[] = [500, 1000, 2000, 5000, 10_000];

export interface OptionsLienWebSocket {
  readonly connecter: ConnecteurWebSocket;
  readonly horloge?: HorlogeTransport;
  readonly backoffMs?: readonly number[];
  readonly modeIntegrite?: ModeIntegrite;
}

export class LienWebSocket implements Lien, CanalControleProcessus {
  #etat: EtatLien = 'coupe_transitoire';
  #ws: WebSocketLike | null = null;
  #rattachements = 0;
  #remonteesTransitoires = 0;
  #tentative = 0;
  #annulerReconnexion: (() => void) | null = null;
  #killEnAttente: string | null = null;
  readonly #stdin: CanalDonnees;
  readonly #stdout: CanalDonnees;
  readonly #abonnesFermeture: Array<(f: FermetureTerminale) => void> = [];
  readonly #abonnesStderr: Array<(texte: string) => void> = [];
  readonly #abonnesExit: Array<(code: number | null, signal: string | null) => void> = [];
  readonly #abonnesErreurSpawn: Array<(message: string) => void> = [];
  readonly #horloge: HorlogeTransport;
  readonly #backoff: readonly number[];
  readonly #log = transportLogger.child({ composant: 'lien-websocket' });

  constructor(private readonly options: OptionsLienWebSocket) {
    this.#horloge = options.horloge ?? HORLOGE_REELLE;
    this.#backoff = options.backoffMs ?? BACKOFF_DEFAUT;
    const mode = options.modeIntegrite ?? 'strict';
    this.#stdin = new CanalDonnees({ nom: 'pi->pc', modeIntegrite: mode, envoyer: (s, p) => this.#envoyer(TAG.STDIN, s, p) });
    this.#stdout = new CanalDonnees({ nom: 'pc->pi', modeIntegrite: mode, envoyer: (s, p) => this.#envoyer(TAG.STDOUT, s, p) });
  }

  /** Première connexion (« rattachement à froid », D.2.3 — l'epoch est géré par l'appelant). */
  async connecter(): Promise<void> {
    await this.#tenterConnexion();
  }

  etat(): EtatLien {
    return this.#etat;
  }

  versPc(): Tuyau {
    return this.#stdin;
  }

  versPi(): Tuyau {
    return this.#stdout;
  }

  surFermeture(abonne: (f: FermetureTerminale) => void): void {
    this.#abonnesFermeture.push(abonne);
  }

  surStderr(abonne: (texte: string) => void): void {
    this.#abonnesStderr.push(abonne);
  }

  surExit(abonne: (code: number | null, signal: string | null) => void): void {
    this.#abonnesExit.push(abonne);
  }

  surErreurSpawn(abonne: (message: string) => void): void {
    this.#abonnesErreurSpawn.push(abonne);
  }

  remonteesTransitoires(): number {
    return this.#remonteesTransitoires;
  }

  rattachements(): number {
    return this.#rattachements;
  }

  /** Relaie le signal au processus distant (B.2.2). Best-effort si le lien est coupé. */
  envoyerKill(signal: string): void {
    this.#killEnAttente = signal;
    this.#envoyer(TAG.KILL, 0, encoderTexte(signal));
  }

  /** Fermeture volontaire, terminale : aucune reconnexion ne suivra. */
  fermer(): void {
    this.#annulerReconnexion?.();
    this.#annulerReconnexion = null;
    this.#ws?.close(1000, 'fermeture volontaire');
    this.#etat = 'ferme_terminal';
  }

  async #tenterConnexion(): Promise<void> {
    try {
      const ws = await this.options.connecter();
      this.#brancher(ws);
      this.#etat = 'ouvert';
      this.#tentative = 0;
      this.#rattachements += 1;
      this.#stdin.rejouerNonAcquitte();
      if (this.#killEnAttente !== null) this.#envoyer(TAG.KILL, 0, encoderTexte(this.#killEnAttente));
    } catch (erreur) {
      this.#log.warn({ err: erreur }, 'connexion échouée, nouvelle tentative planifiée');
      this.#planifierReconnexion();
    }
  }

  #brancher(ws: WebSocketLike): void {
    this.#ws = ws;
    ws.addEventListener('message', (ev) => this.#surMessage(ev.data));
    ws.addEventListener('close', (ev) => this.#surFermetureWs(ev.code, ev.reason));
    ws.addEventListener('error', (erreur) => this.#log.warn({ err: erreur }, "erreur ws — le close qui suit tranche"));
  }

  #surMessage(donnee: unknown): void {
    let trame;
    try {
      trame = decoderTrame(versUint8Array(donnee));
    } catch (erreur) {
      this.#log.error({ err: erreur }, 'trame illisible — intégrité potentiellement rompue');
      throw erreur;
    }
    this.#distribuer(trame.tag, trame.seq, trame.payload);
  }

  #distribuer(tag: number, seq: number, payload: Uint8Array): void {
    switch (tag) {
      case TAG.STDOUT:
        this.#stdout.recevoir(seq, payload);
        this.#envoyer(TAG.ACK, 0, encoderTexte(String(this.#stdout.dernierRecuContigu())));
        return;
      case TAG.ACK:
        this.#stdin.acquitterJusque(Number(decoderTexte(payload)));
        return;
      case TAG.STDERR:
        for (const a of this.#abonnesStderr) a(decoderTexte(payload));
        return;
      case TAG.EXIT: {
        const { code, signal } = decoderExit(payload);
        for (const a of this.#abonnesExit) a(code, signal);
        return;
      }
      case TAG.ERREUR_SPAWN:
        for (const a of this.#abonnesErreurSpawn) a(decoderTexte(payload));
        return;
      default:
        this.#log.warn({ tag }, 'tag de trame inconnu, ignoré');
    }
  }

  #envoyer(tag: (typeof TAG)[keyof typeof TAG], seq: number, payload: Uint8Array): void {
    if (this.#ws === null || this.#ws.readyState !== WS_OUVERT) return;
    this.#ws.send(encoderTrame(tag, seq, payload));
  }

  #surFermetureWs(code: number, reason: string): void {
    const terminal = CODES_WS_VERS_TAXONOMIE[code];
    if (terminal !== undefined) {
      this.#etat = 'ferme_terminal';
      const fermeture: FermetureTerminale = {
        terminal: true,
        code: terminal,
        raison: reason.length > 0 ? reason : RAISONS[terminal],
        rattachementAutorise: terminal !== 4090,
      };
      this.#log.error({ fermeture }, 'fermeture terminale du lien');
      for (const a of this.#abonnesFermeture) a(fermeture);
      return;
    }
    // Transitoire : absorbé en silence (D.2.1). `remonteesTransitoires` reste à 0.
    this.#etat = 'coupe_transitoire';
    this.#log.debug({ code, reason }, 'coupure transitoire — reconnexion en interne, rien ne remonte');
    this.#planifierReconnexion();
  }

  #planifierReconnexion(): void {
    const index = Math.min(this.#tentative, this.#backoff.length - 1);
    const delai = this.#backoff[index] ?? this.#backoff[this.#backoff.length - 1] ?? 1000;
    this.#tentative += 1;
    this.#annulerReconnexion = this.#horloge.planifier(delai, () => {
      void this.#tenterConnexion();
    });
  }
}
