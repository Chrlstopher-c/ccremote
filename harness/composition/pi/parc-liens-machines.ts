/**
 * Responsabilité : côté Pi, tenir UN LIEN PAR MACHINE DE TRAVAIL identifiée, et
 * arbitrer les connexions entrantes entre elles.
 *
 * `☠ CE QUE CE FICHIER CORRIGE` — jusqu'au 01/08, le serveur du lien tenait une
 * file à un seul emplacement (`FileConnexionUnique`) : toute connexion
 * authentifiée évinçait la précédente, quelle que soit sa provenance. C'est la
 * dette n°6 du dépôt, mesurée au banc du 22/07 : **1268 évictions** en boucle
 * dès que deux superviseurs tournaient en même temps, chacun chassant l'autre
 * indéfiniment. Le symptôme visible — « des workers meurent sans raison » — ne
 * ressemblait en RIEN à sa cause, ce qui est exactement ce qui rendait la panne
 * chère. Conséquence d'exploitation : le PC a dû être arrêté pour laisser vivre
 * le VPS.
 *
 * La règle nouvelle tient en une ligne : **le supersede ne joue plus qu'à
 * identité ÉGALE**.
 *  - Deux machines distinctes cohabitent, chacune avec son propre lien.
 *  - Deux process d'une MÊME machine s'évincent toujours — c'est voulu, c'est la
 *    reprise après crash : le nouveau process doit pouvoir reprendre la place de
 *    l'ancien sans attendre l'expiration d'un ping.
 *
 * `☠` Un lien par machine, jamais un lien partagé multiplexé. `LienWebSocket`
 * porte un état de reprise (backoff, rejeu du non-acquitté, ping/pong) qui n'a
 * de sens que pour UNE socket : le partager entre deux machines ferait que
 * l'extinction de l'une décrète l'autre morte.
 *
 * `☠` Les liens ne sont JAMAIS retirés de la table quand une machine se
 * déconnecte. Une machine éteinte est un état nominal (H-75) : son lien reste,
 * en attente de la prochaine connexion, et `etat()` dit `'ferme'` — ce qui est
 * précisément l'information dont l'interface a besoin. Le retirer perdrait le
 * fait qu'elle existe, et une mission qui vit dessus deviendrait irroutable.
 */

import { LienWebSocket, type WebSocketLike } from '../../transport/lien-websocket.ts';
import type { HorlogeTransport } from '../../transport/horloge-transport.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'parc-liens-machines' });

/**
 * File à un seul emplacement, POUR UNE IDENTITÉ DONNÉE : la connexion la plus
 * récente non encore consommée par `LienWebSocket`.
 */
export class FileConnexion {
  #enFile: WebSocketLike | null = null;
  #enAttente: ((ws: WebSocketLike) => void) | null = null;
  #actif: WebSocketLike | null = null;
  #supersedes = 0;

  get supersedes(): number {
    return this.#supersedes;
  }

  /** `true` si une connexion de cette machine est actuellement rattachée. */
  get occupe(): boolean {
    return this.#actif !== null;
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
  oublier(connexion: WebSocketLike): void {
    if (this.#actif === connexion) this.#actif = null;
    if (this.#enFile === connexion) this.#enFile = null;
  }

  /**
   * Accepte une connexion de CETTE machine. Évince l'actif s'il y en a un —
   * c'est-à-dire uniquement un autre process de la même machine.
   */
  accepter(connexion: WebSocketLike): void {
    if (this.#actif !== null) {
      this.#supersedes += 1;
      this.#actif.close(1000, 'remplacée par une connexion plus récente de la même machine');
    }
    if (this.#enAttente !== null) {
      const resoudre = this.#enAttente;
      this.#enAttente = null;
      this.#actif = connexion;
      resoudre(connexion);
      return;
    }
    this.#enFile = connexion;
    this.#actif = connexion;
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

export interface OptionsParcLiensMachines {
  readonly horloge?: HorlogeTransport;
  /**
   * Appelé UNE SEULE FOIS par machine, à sa toute première connexion, de façon
   * SYNCHRONE et AVANT que la connexion ne soit rattachée.
   *
   * `☠` L'ordre n'est pas négociable : `ClientSuperviseurPc` s'abonne au tuyau
   * du lien dans son constructeur. Construit après le rattachement, il manquerait
   * les enveloppes déjà en transit — et la première réconciliation d'une machine
   * qui se rattache est justement le moment où il en circule.
   */
  readonly surNouvelleMachine?: (machineId: string, lien: LienWebSocket) => void;
}

/** Une machine connue du Pi, et l'état réel de son lien. */
export interface EtatMachineLien {
  readonly machineId: string;
  readonly enLigne: boolean;
  readonly supersedes: number;
}

export class ParcLiensMachines {
  readonly #machines = new Map<string, { readonly file: FileConnexion; readonly lien: LienWebSocket }>();

  constructor(private readonly options: OptionsParcLiensMachines = {}) {}

  /**
   * Rattache une connexion entrante à l'identité annoncée, en créant le lien de
   * cette machine si c'est sa première apparition.
   */
  accepter(machineId: string, connexion: WebSocketLike): void {
    const entree = this.#garantir(machineId);
    if (entree.file.occupe) {
      log.warn(
        { machineId },
        'nouvelle connexion d une machine déjà rattachée — supersede à identité ÉGALE (reprise après crash attendue)',
      );
    }
    entree.file.accepter(connexion);
  }

  /** À appeler sur fermeture, AVANT de réveiller le lien (voir `serveur-lien-pc.ts`). */
  oublier(machineId: string, connexion: WebSocketLike): void {
    this.#machines.get(machineId)?.file.oublier(connexion);
  }

  lienPour(machineId: string): LienWebSocket | null {
    return this.#machines.get(machineId)?.lien ?? null;
  }

  /** Toutes les machines vues depuis le démarrage du Pi, en ligne ou non (H-75). */
  machines(): readonly EtatMachineLien[] {
    return [...this.#machines.entries()].map(([machineId, { file, lien }]) => ({
      machineId,
      enLigne: lien.etat() === 'ouvert',
      supersedes: file.supersedes,
    }));
  }

  machinesEnLigne(): readonly string[] {
    return this.machines()
      .filter((m) => m.enLigne)
      .map((m) => m.machineId);
  }

  /**
   * Évictions cumulées, toutes machines confondues. `☠` Doit rester à 0 en
   * exploitation nominale — y compris avec plusieurs machines, puisqu'une
   * éviction ne peut plus venir que d'un doublon de process sur UNE machine.
   * C'est la métrique qui a révélé la dette n°6 ; elle reste observable.
   */
  supersedes(): number {
    return this.machines().reduce((total, m) => total + m.supersedes, 0);
  }

  fermer(): void {
    for (const { lien } of this.#machines.values()) lien.fermer();
  }

  #garantir(machineId: string): { readonly file: FileConnexion; readonly lien: LienWebSocket } {
    const existante = this.#machines.get(machineId);
    if (existante !== undefined) return existante;

    const file = new FileConnexion();
    const lien = new LienWebSocket({
      connecter: () => file.connecter(),
      horloge: this.options.horloge,
      // `☠` `'perte_silencieuse'` — choix délibéré, détaillé en tête de
      // `serveur-lien-pc.ts` : ce lien n'emprunte que `versPi()`, jamais rejoué
      // au rattachement, et `'strict'` ferait lever sur le premier octet perdu.
      modeIntegrite: 'perte_silencieuse',
    });
    const entree = { file, lien };
    this.#machines.set(machineId, entree);

    // Synchrone et AVANT le rattachement — voir `surNouvelleMachine`.
    this.options.surNouvelleMachine?.(machineId, lien);
    void lien.connecter();
    log.info({ machineId, machinesConnues: this.#machines.size }, 'nouvelle machine de travail connue du Pi');
    return entree;
  }
}
