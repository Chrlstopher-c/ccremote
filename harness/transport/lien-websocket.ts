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
 *
 * **Vivacité applicative (dette de M-10, H-69)** — un lien peut mourir sans
 * jamais déclencher `close` ni `error` : le socket paraît vivant, plus rien ne
 * transite. Rendu bruyant par un ping/pong applicatif : tant que le lien est
 * `ouvert`, un tic de vivacité sonde le pair (`TAG.PING`) à chaque intervalle
 * où aucun octet n'a été reçu depuis le tic précédent. Le pair — qui exécute
 * la même classe, symétriquement — répond `TAG.PONG` **dans `#distribuer`**,
 * jamais via l'agent qu'il transporte : c'est cette indépendance qui distingue
 * un agent réellement lent (le transport répond, l'agent se tait) d'un tunnel
 * mort (rien ne répond, ni l'agent ni le transport). Au-delà de
 * `pingsManquesAvantMort` tics consécutifs sans le moindre octet reçu, la
 * coupure est déclarée silencieuse et traitée par **exactement** le même
 * chemin de reprise qu'une coupure signalée (`#entrerCoupeTransitoire` :
 * même backoff, même compteur de rattachements, même rejeu du non-acquitté).
 * Aucun second mécanisme de reprise n'est inventé.
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

/**
 * `☠ CONTRAT` — la promesse ne doit se résoudre que sur une socket RÉELLEMENT
 * ouverte, et rejeter si la connexion échoue.
 *
 * Ce n'est pas une préférence de style : `#tenterConnexion` interprète la
 * résolution comme « connecté » et remet le compteur de backoff à zéro. Un
 * connecteur qui résout trop tôt neutralise donc le backoff entier — mesuré en
 * réel le 2026-07-22 avec `Promise.resolve(new WebSocket(url))`, qui ne rejette
 * jamais : ~2 tentatives par seconde au lieu d'une toutes les 10 s. Voir
 * `composition/pc/client-lien-pi.ts` pour un connecteur conforme.
 */
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

/**
 * Cadence du sondage de vivacité. 15 s : assez court pour rester sous les
 * délais usuels de coupure des NAT/routeurs Wi-Fi sur une coupure idle
 * (souvent 30-60 s), assez long pour ne rien ajouter de mesurable au trafic
 * d'une mission active.
 */
const INTERVALE_PING_MS_DEFAUT = 15_000;

/**
 * Tics consécutifs sans le moindre octet reçu avant de déclarer la coupure
 * silencieuse. 3 : un unique ping perdu (congestion passagère) ne déclenche
 * rien — le compteur revient à zéro dès qu'un seul octet, de n'importe quel
 * tag, est reçu. Il faut un silence total sur trois intervalles pleins
 * (~45 s par défaut) pour conclure à la mort du lien. Un faux positif détruit
 * une mission valide (exigence de la mission) ; ce seuil est délibérément
 * généreux plutôt que réactif.
 */
const PINGS_MANQUES_AVANT_MORT_DEFAUT = 3;

export interface OptionsLienWebSocket {
  readonly connecter: ConnecteurWebSocket;
  readonly horloge?: HorlogeTransport;
  readonly backoffMs?: readonly number[];
  readonly modeIntegrite?: ModeIntegrite;
  /** Cadence du ping de vivacité, ms. `<= 0` désactive le mécanisme (opt-out explicite). */
  readonly intervalePingMs?: number;
  /** Tics consécutifs sans octet reçu avant de déclarer une coupure silencieuse. */
  readonly pingsManquesAvantMort?: number;
}

export class LienWebSocket implements Lien, CanalControleProcessus {
  #etat: EtatLien = 'coupe_transitoire';
  #ws: WebSocketLike | null = null;
  #rattachements = 0;
  #remonteesTransitoires = 0;
  #tentative = 0;
  #annulerReconnexion: (() => void) | null = null;
  #killEnAttente: string | null = null;
  #annulerVivacite: (() => void) | null = null;
  #activiteDepuisTick = false;
  #pingsManques = 0;
  #coupuresSilencieuses = 0;
  readonly #stdin: CanalDonnees;
  readonly #stdout: CanalDonnees;
  readonly #abonnesFermeture: Array<(f: FermetureTerminale) => void> = [];
  readonly #abonnesStderr: Array<(texte: string) => void> = [];
  readonly #abonnesExit: Array<(code: number | null, signal: string | null) => void> = [];
  readonly #abonnesErreurSpawn: Array<(message: string) => void> = [];
  readonly #horloge: HorlogeTransport;
  readonly #backoff: readonly number[];
  readonly #intervalePingMs: number;
  readonly #pingsManquesAvantMort: number;
  readonly #log = transportLogger.child({ composant: 'lien-websocket' });

  constructor(private readonly options: OptionsLienWebSocket) {
    this.#horloge = options.horloge ?? HORLOGE_REELLE;
    this.#backoff = options.backoffMs ?? BACKOFF_DEFAUT;
    this.#intervalePingMs = options.intervalePingMs ?? INTERVALE_PING_MS_DEFAUT;
    // Plancher à 1 : un seuil nul ou négatif déclarerait le lien mort au premier tic.
    this.#pingsManquesAvantMort = Math.max(1, options.pingsManquesAvantMort ?? PINGS_MANQUES_AVANT_MORT_DEFAUT);
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

  coupuresSilencieusesDetectees(): number {
    return this.#coupuresSilencieuses;
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
    this.#arreterVivacite();
    this.#ws?.close(1000, 'fermeture volontaire');
    this.#etat = 'ferme_terminal';
  }

  async #tenterConnexion(): Promise<void> {
    try {
      const ws = await this.options.connecter();
      // `☠` Garde-fou du contrat de `ConnecteurWebSocket` (voir sa doc). Un
      // connecteur qui résout sur une socket non ouverte éteindrait tout le
      // backoff en silence — l'échec doit être BRUYANT ici, pas découvert un
      // mois plus tard en regardant les journaux du serveur d'en face.
      if (ws.readyState !== WS_OUVERT) {
        throw new Error(
          `connecteur non conforme : socket en readyState=${ws.readyState}, attendu ${WS_OUVERT} (ouvert). Voir le contrat de ConnecteurWebSocket.`,
        );
      }
      this.#brancher(ws);
      this.#etat = 'ouvert';
      this.#tentative = 0;
      this.#rattachements += 1;
      this.#stdin.rejouerNonAcquitte();
      if (this.#killEnAttente !== null) this.#envoyer(TAG.KILL, 0, encoderTexte(this.#killEnAttente));
      this.#pingsManques = 0;
      this.#activiteDepuisTick = false;
      this.#demarrerVivacite();
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
    // N'importe quel tag prouve que le lien transporte encore des octets dans
    // les deux sens — c'est la preuve de vie consommée par le tic de vivacité.
    this.#activiteDepuisTick = true;
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
      case TAG.PING:
        // Réponse générée ici, dans la couche transport — jamais par l'agent
        // qu'elle transporte. C'est cette indépendance qui rend un agent lent
        // discernable d'un tunnel mort (voir le doc de tête de fichier).
        this.#envoyer(TAG.PONG, 0, new Uint8Array(0));
        return;
      case TAG.PONG:
        // Rien à faire de plus : `#surMessage` a déjà enregistré la preuve de vie.
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
    this.#arreterVivacite();
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
    this.#entrerCoupeTransitoire(`fermeture ws code=${code} reason=${reason}`);
  }

  /**
   * Chemin de reprise partagé (☠ exigence de la mission) — signalé (`close`
   * WS non terminal) ou silencieux (vivacité expirée) y entrent identiquement.
   * `remonteesTransitoires` reste volontairement à 0 dans les deux cas :
   * D.2.1 veut que le transitoire soit absorbé, jamais remonté à l'appelant.
   */
  #entrerCoupeTransitoire(motif: string): void {
    this.#etat = 'coupe_transitoire';
    this.#log.debug({ motif }, 'coupure transitoire — reconnexion en interne, rien ne remonte');
    this.#planifierReconnexion();
  }

  /**
   * Classe une fermeture survenue AVANT que la socket ne soit branchée — le
   * cas du refus d'authentification, que le serveur ferme (4401) juste après
   * l'upgrade, donc parfois avant même l'événement `open` côté client.
   *
   * `☠` Sans ce point d'entrée, un connecteur conforme au contrat (qui ne
   * résout que sur `open`) ferait DISPARAÎTRE la taxonomie terminale : le refus
   * de secret redeviendrait une coupure transitoire retentée à l'infini, sans
   * jamais nommer sa cause. Mesuré en réel le 2026-07-22, c'est la régression
   * qu'a introduite la correction du backoff avant d'être complétée ici.
   */
  signalerFermetureAvantOuverture(code: number, raison: string): void {
    // `☠` STRICTEMENT le classement d'un code TERMINAL, jamais la reprise. Le
    // connecteur qui appelle cette méthode va rejeter juste après, et c'est ce
    // rejet qui planifie la reconnexion. Traiter aussi le cas transitoire ici
    // planifierait DEUX reconnexions par échec — mesuré en réel : les
    // tentatives se multipliaient au lieu de s'espacer (211 en 60 s au lieu
    // de 8). Une correction qui aggrave le défaut qu'elle vise est encore
    // possible tant qu'on ne la mesure pas.
    if (CODES_WS_VERS_TAXONOMIE[code] === undefined) return;
    this.#surFermetureWs(code, raison);
  }

  #planifierReconnexion(): void {
    // `☠` Une fermeture terminale ne se reconnecte JAMAIS, quel que soit le
    // chemin qui mène ici — y compris le `catch` de `#tenterConnexion`, qui
    // s'exécute après que le connecteur a déjà classé la fermeture.
    if (this.#etat === 'ferme_terminal') return;
    const index = Math.min(this.#tentative, this.#backoff.length - 1);
    const delai = this.#backoff[index] ?? this.#backoff[this.#backoff.length - 1] ?? 1000;
    this.#tentative += 1;
    this.#annulerReconnexion = this.#horloge.planifier(delai, () => {
      void this.#tenterConnexion();
    });
  }

  #demarrerVivacite(): void {
    if (this.#intervalePingMs <= 0) return; // désactivé explicitement (opt-out)
    this.#annulerVivacite = this.#horloge.planifier(this.#intervalePingMs, () => this.#tickVivacite());
  }

  #arreterVivacite(): void {
    this.#annulerVivacite?.();
    this.#annulerVivacite = null;
  }

  /**
   * Un tic par intervalle, tant que le lien est `ouvert`. Sonde le pair par
   * PING inconditionnellement (coût : une trame vide par intervalle, jamais
   * plus) ; ne compte un tic « manqué » que si strictement aucun octet, de
   * quelque tag que ce soit, n'a été reçu depuis le tic précédent — un agent
   * qui ne produit rien mais dont le pair continue de répondre au ping n'est
   * **jamais** compté comme manqué (protection contre le faux positif exigée
   * par la mission).
   */
  #tickVivacite(): void {
    if (this.#etat !== 'ouvert') return;
    if (this.#activiteDepuisTick) {
      this.#pingsManques = 0;
    } else {
      this.#pingsManques += 1;
      if (this.#pingsManques >= this.#pingsManquesAvantMort) {
        this.#declencherCoupureSilencieuse();
        return; // la reconnexion est déjà planifiée par le chemin partagé
      }
    }
    this.#activiteDepuisTick = false;
    this.#envoyer(TAG.PING, 0, new Uint8Array(0));
    this.#demarrerVivacite();
  }

  /**
   * Ni `close` ni `error` : le socket paraît vivant, plus rien ne transite.
   * Traité par le chemin de reprise partagé — pas de second mécanisme.
   */
  #declencherCoupureSilencieuse(): void {
    if (this.#etat !== 'ouvert') return;
    this.#coupuresSilencieuses += 1;
    this.#arreterVivacite();
    this.#log.error(
      { pingsManques: this.#pingsManques, seuil: this.#pingsManquesAvantMort },
      'coupure silencieuse détectée (ping/pong sans réponse au-delà du seuil) — rendue bruyante, ' +
        'traitée comme une coupure transitoire',
    );
    this.#entrerCoupeTransitoire('vivacité — silence ping/pong au-delà du seuil');
  }
}
