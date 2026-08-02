/**
 * Responsabilité : côté Pi, savoir À QUELLE MACHINE adresser une opération, et
 * la lui adresser.
 *
 * `☠ CE QUE CE FICHIER REMPLACE` — jusqu'au 01/08, `assembler-control-plane.ts`
 * construisait UN `ClientSuperviseurPc` et le passait à ses six consommateurs
 * (dispatch, réconciliation, arrêt, relance, inventaire, télémétrie). « Le PC »
 * était un singulier de fait : il n'existait aucun endroit où poser la question
 * « lequel ? ». Ce module est cet endroit.
 *
 * Trois familles d'opérations, trois routages différents — et les confondre
 * serait le prochain défaut :
 *
 *  1. **Portées par une mission** (arrêt, relance, instruction, pause, reprise,
 *     inspection) → la machine où l'équipe tourne RÉELLEMENT, lue sur
 *     `mission.machine` (migration 22, écrite au dispatch). Machine hors ligne
 *     ⇒ REFUS explicite, jamais un succès silencieux : un ordre d'arrêt qui ne
 *     part nulle part est pire que pas d'ordre du tout.
 *  2. **Portées par une conversation** (exploration de projets, lecture,
 *     recherche, dispatch d'un mandat) → la machine choisie à la création du
 *     fil (`conversation.machine`).
 *  3. **Globales** (télémétrie, jetons) → toutes les machines EN LIGNE,
 *     agrégées. Une machine éteinte n'apporte rien et n'est pas une erreur
 *     (H-75) ; elle ne doit surtout pas faire échouer le relevé des autres.
 *
 * `☠` La réconciliation n'est dans AUCUNE de ces familles : elle est PAR
 * MACHINE, avec l'inventaire de cette machine et les missions de cette machine
 * seulement. Voir `reconciliation-sur-rattachement.ts` — c'est le point où une
 * agrégation naïve marquerait « fantômes » toutes les missions des machines
 * hors ligne.
 */

import type { Registre } from '../../control-plane/registre/index.ts';
import type { TelemetrieWorker, JetonCompte } from '../../superviseur/index.ts';
import { ErreurRoutageMachine } from '../../shared/routage-machine.ts';
import type { ClientSuperviseurPc } from './client-superviseur-pc.ts';
import { compositionLogger } from '../logger.ts';

// Réexporté : les appelants de ce module attrapent le refus qu'il lève.
export { ErreurRoutageMachine } from '../../shared/routage-machine.ts';

const log = compositionLogger.child({ composant: 'parc-superviseurs' });

export interface MachineRoutee {
  readonly machineId: string;
  readonly client: ClientSuperviseurPc;
}

export interface OptionsParcSuperviseurs {
  readonly registre: Registre;
  /** État RÉEL du lien de cette machine — jamais un drapeau tenu à la main. */
  readonly enLigne: (machineId: string) => boolean;
}

export class ParcSuperviseurs {
  readonly #clients = new Map<string, ClientSuperviseurPc>();

  constructor(private readonly options: OptionsParcSuperviseurs) {}

  /** Appelé à la PREMIÈRE connexion d'une machine, depuis la composition. */
  enregistrer(machineId: string, client: ClientSuperviseurPc): void {
    this.#clients.set(machineId, client);
    log.info({ machineId, machinesConnues: this.#clients.size }, 'machine de travail enregistrée au parc');
  }

  /** `null` si cette machine ne s'est jamais présentée depuis le démarrage du Pi. */
  pour(machineId: string): ClientSuperviseurPc | null {
    return this.#clients.get(machineId) ?? null;
  }

  enLigne(machineId: string): boolean {
    return this.#clients.has(machineId) && this.options.enLigne(machineId);
  }

  /** Toutes les machines connues, en ligne ou non (H-75 : l'absence est nominale). */
  machinesConnues(): readonly string[] {
    return [...this.#clients.keys()];
  }

  machinesEnLigne(): readonly string[] {
    return this.machinesConnues().filter((m) => this.options.enLigne(m));
  }

  /** `true` dès qu'au moins une machine de travail est joignable. */
  auMoinsUneEnLigne(): boolean {
    return this.machinesEnLigne().length > 0;
  }

  clientsEnLigne(): readonly MachineRoutee[] {
    return this.machinesEnLigne().map((machineId) => ({
      machineId,
      // Non-nul par construction : `machinesEnLigne` filtre `#clients`.
      client: this.#clients.get(machineId) as ClientSuperviseurPc,
    }));
  }

  /**
   * Résout une machine DEMANDÉE (celle d'un fil, d'une mission, d'un mandat).
   *
   * `☠` `null` n'est PAS « n'importe laquelle » : c'est « non précisée », ce qui
   * n'arrive que pour un fil créé avant le sélecteur de machine (migration 22).
   * On ne tranche alors que si le choix est SANS AMBIGUÏTÉ — une seule machine
   * en ligne. À deux, deviner reviendrait à lancer une équipe sur la mauvaise
   * machine, sur un clone du dépôt, en silence.
   */
  resoudre(machine: string | null | undefined, contexte: string): MachineRoutee {
    const enLigne = this.machinesEnLigne();

    if (machine === null || machine === undefined || machine === '') {
      if (enLigne.length === 1) {
        return { machineId: enLigne[0] as string, client: this.#clients.get(enLigne[0] as string) as ClientSuperviseurPc };
      }
      if (enLigne.length === 0) {
        throw new ErreurRoutageMachine(
          `${contexte} : aucune machine de travail n'est en ligne. Machines connues : ${this.#lister()}`,
        );
      }
      throw new ErreurRoutageMachine(
        `${contexte} : aucune machine précisée et plusieurs sont en ligne (${enLigne.join(', ')}) — préciser laquelle`,
      );
    }

    const client = this.#clients.get(machine);
    if (client === undefined) {
      throw new ErreurRoutageMachine(
        `${contexte} : machine « ${machine} » inconnue. Machines connues : ${this.#lister()}`,
      );
    }
    if (!this.options.enLigne(machine)) {
      throw new ErreurRoutageMachine(
        `${contexte} : la machine « ${machine} » est hors ligne. En ligne actuellement : ${enLigne.length === 0 ? 'aucune' : enLigne.join(', ')}`,
      );
    }
    return { machineId: machine, client };
  }

  /** La machine où une mission tourne réellement. Lève si elle est hors ligne. */
  pourMission(missionId: string): MachineRoutee {
    const mission = this.options.registre.missions.lire(missionId);
    if (mission === null) throw new ErreurRoutageMachine(`mission ${missionId} inconnue du registre`);
    return this.resoudre(mission.machine, `mission ${missionId}`);
  }

  /**
   * La machine choisie à la création d'un fil. Lève si elle est hors ligne.
   *
   * `☠ ADOPTION` — un fil sans machine (créé quand une seule était en ligne, donc
   * sans question posée) FIGE son choix implicite dès la première opération.
   * Sans cela le fil restait `null` indéfiniment et basculait en refus permanent
   * le jour où la seconde machine s'allumait : ce qui marchait le matin ne
   * marchait plus l'après-midi, sans qu'aucune action de l'opérateur n'explique
   * le changement (prod, 02/08, conversation `af847b10`).
   *
   * L'adoption n'INVENTE rien : elle écrit la machine que le routage venait déjà
   * de choisir seul, et seulement quand ce choix était sans ambiguïté.
   */
  pourConversation(conversationId: string): MachineRoutee {
    const conv = this.options.registre.conversations.lire(conversationId);
    if (conv === null) throw new ErreurRoutageMachine(`conversation ${conversationId} inconnue du registre`);
    const routee = this.resoudre(conv.machine, `conversation ${conversationId}`);
    if (conv.machine === null || conv.machine === '') {
      this.options.registre.conversations.definirMachine(conversationId, routee.machineId);
      log.info(
        { conversationId, machineId: routee.machineId },
        'fil rattaché à sa machine par adoption — seule machine en ligne au moment de la première opération',
      );
    }
    return routee;
  }

  #lister(): string {
    const connues = this.machinesConnues();
    if (connues.length === 0) return 'aucune (aucune machine ne s’est encore connectée au Pi)';
    return connues.map((m) => `${m}${this.options.enLigne(m) ? ' (en ligne)' : ' (hors ligne)'}`).join(', ');
  }
}

/**
 * Relevés GLOBAUX : la somme de ce que rapportent les machines en ligne.
 *
 * `☠` Une machine hors ligne rend `[]` et non une erreur — c'est le principe
 * H-75 appliqué à la lettre. Une machine EN LIGNE qui échoue ne doit pas
 * annuler le relevé des autres non plus : chaque appel est isolé.
 */
export function creerAgregatParc(parc: ParcSuperviseurs): {
  telemetrie(): Promise<readonly TelemetrieWorker[]>;
  jetons(): Promise<readonly JetonCompte[]>;
} {
  return {
    async telemetrie(): Promise<readonly TelemetrieWorker[]> {
      const parMachine = await Promise.all(
        parc.clientsEnLigne().map(async ({ machineId, client }) => {
          try {
            return await client.telemetrie();
          } catch (erreur) {
            log.debug({ err: erreur, machineId }, 'télémétrie d’une machine indisponible — les autres restent relevées');
            return [];
          }
        }),
      );
      return parMachine.flat();
    },

    async jetons(): Promise<readonly JetonCompte[]> {
      const parMachine = await Promise.all(
        parc.clientsEnLigne().map(async ({ machineId, client }) => {
          try {
            return (await client.jetons()).map((jeton) => ({ jeton, machineId }));
          } catch (erreur) {
            log.debug({ err: erreur, machineId }, 'jetons d’une machine indisponibles — les autres restent relevés');
            return [];
          }
        }),
      );

      // `☠` Le MÊME identifiant de compte peut remonter de deux machines : les
      // comptes Claude sont déclarés par machine (`CCREMOTE_PC_COMPTES`) et le
      // VPS comme le PC connaissent tous deux `compte-a`. Le premier relevé
      // gagne, et le doublon est DIT — il signale un compte partagé, donc des
      // fenêtres de rate limit qui se marchent dessus. Le taire ferait osciller
      // la jauge entre deux mesures sans que personne comprenne pourquoi.
      const parId = new Map<string, { readonly jeton: JetonCompte; readonly machineId: string }>();
      for (const entree of parMachine.flat()) {
        const deja = parId.get(entree.jeton.compteId);
        if (deja !== undefined) {
          log.warn(
            { compteId: entree.jeton.compteId, machines: [deja.machineId, entree.machineId] },
            'compte Claude déclaré sur DEUX machines — un seul relevé retenu ; leurs fenêtres de rate limit se partagent',
          );
          continue;
        }
        parId.set(entree.jeton.compteId, entree);
      }
      return [...parId.values()].map((e) => e.jeton);
    },
  };
}
