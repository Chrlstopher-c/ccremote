/**
 * Responsabilité : le drill récurrent de l'arrêt d'urgence (G.4.3, mission M-52).
 *
 * ☠ (d) mécanique retenue pour « testé régulièrement, pas une fois » : un
 * scheduler déclenche, à intervalle, la VRAIE séquence de production
 * (`SuperviseurWorkers.arreterMissionEnUrgence`, via `PortDrillArretUrgence` —
 * jamais réimplémentée ni simulée) contre UNE mission canari dédiée. Un drill
 * n'est compté « réussi » que si `ETAPE_PREUVE_COMPLETE` ('forcage') apparaît
 * dans les étapes rendues — c'est la preuve que le filet de dernier recours a
 * réellement été exercé, pas seulement que l'appel n'a pas levé. Une staleness
 * (aucun succès depuis trop longtemps) alerte même si le scheduler tourne
 * encore mais que chaque tentative échoue.
 *
 * ☠ Ce n'est PAS un interrupteur de simulation de panne dans un module de
 * production (piège payé le 2026-07-22, `simulerPanneOrphelinIgnore`) : ce
 * module ne fait aucun `if (mode==='test')` qui bifurque le comportement de
 * l'arrêt d'urgence lui-même — il APPELLE la vraie méthode publique, sur une
 * cible canari fournie par l'appelant. Le chemin exercé est le chemin réel.
 */

import { arretUrgenceLogger } from './logger.ts';
import { ETAPE_PREUVE_COMPLETE } from './types.ts';
import type { AlerteDrill, EtatDrill, MotifAlerte, PortDrillArretUrgence } from './types.ts';

const INTERVALLE_MS_DEFAUT = 24 * 60 * 60 * 1000; // 1 jour
const SEUIL_ALERTE_MS_DEFAUT = 3 * INTERVALLE_MS_DEFAUT; // trois occasions manquées

export interface PoigneePlanification {
  readonly annuler: () => void;
}

export interface OptionsVerificateurDrill {
  readonly port: PortDrillArretUrgence;
  readonly missionIdCanari: string;
  readonly intervalleMs?: number;
  /** Au-delà de ce délai sans succès, alerte de péremption (G.4.3). */
  readonly seuilAlerteMs?: number;
  readonly graceMs?: number;
  /** Réel = `setInterval`. Injectable : jamais un vrai minuteur en test unitaire. */
  readonly planifier?: (intervalleMs: number, tache: () => void) => PoigneePlanification;
  readonly horloge?: () => number;
  readonly alerte?: (alerte: AlerteDrill) => void;
}

const ETAT_INITIAL: EtatDrill = { executions: 0, dernierSuccesA: null, dernierEchec: null };

/**
 * Bench de drill récurrent. `demarrer()`/`arreter()` pilotent le scheduler ;
 * `executerMaintenant()` est exposé pour permettre un déclenchement manuel
 * (bouton « tester maintenant » côté UI future) sans attendre l'intervalle.
 */
export class VerificateurDrillArretUrgence {
  readonly #port: PortDrillArretUrgence;
  readonly #missionIdCanari: string;
  readonly #intervalleMs: number;
  readonly #seuilAlerteMs: number;
  readonly #graceMs: number | undefined;
  readonly #planifier: (intervalleMs: number, tache: () => void) => PoigneePlanification;
  readonly #horloge: () => number;
  readonly #alerte: (alerte: AlerteDrill) => void;

  #etat: EtatDrill = ETAT_INITIAL;
  #poignee: PoigneePlanification | null = null;

  constructor(options: OptionsVerificateurDrill) {
    this.#port = options.port;
    this.#missionIdCanari = options.missionIdCanari;
    this.#intervalleMs = options.intervalleMs ?? INTERVALLE_MS_DEFAUT;
    this.#seuilAlerteMs = options.seuilAlerteMs ?? SEUIL_ALERTE_MS_DEFAUT;
    this.#graceMs = options.graceMs;
    this.#planifier = options.planifier ?? ((intervalleMs, tache) => {
      const id = setInterval(tache, intervalleMs);
      return { annuler: () => clearInterval(id) };
    });
    this.#horloge = options.horloge ?? (() => Date.now());
    this.#alerte = options.alerte ?? ((alerte) => arretUrgenceLogger.error({ alerte }, 'alerte de drill (aucun callback fourni)'));
  }

  /** Idempotent : démarrer un scheduler déjà actif ne le double jamais. */
  demarrer(): void {
    if (this.#poignee !== null) return;
    this.#poignee = this.#planifier(this.#intervalleMs, () => {
      void this.executerMaintenant();
    });
    arretUrgenceLogger.info({ intervalleMs: this.#intervalleMs }, 'drill arrêt urgence : scheduler démarré (G.4.3)');
  }

  arreter(): void {
    this.#poignee?.annuler();
    this.#poignee = null;
  }

  etat(): EtatDrill {
    return this.#etat;
  }

  /**
   * Exécute un drill immédiatement. Ne lève jamais : un drill est un
   * observateur, pas un déclencheur de crash du scheduler lui-même.
   */
  async executerMaintenant(): Promise<void> {
    this.#etat = { ...this.#etat, executions: this.#etat.executions + 1 };
    try {
      const resultat = await this.#port.arreterMissionEnUrgence(this.#missionIdCanari, this.#graceMs);
      if (resultat === null) {
        this.#echouer('cible_absente', `mission canari "${this.#missionIdCanari}" introuvable ou déjà arrêtée`);
      } else if (!resultat.etapes.includes(ETAPE_PREUVE_COMPLETE)) {
        this.#echouer('sequence_incomplete', `étapes observées : [${resultat.etapes.join(', ')}]`);
      } else {
        this.#reussir();
      }
    } catch (erreur) {
      this.#echouer('drill_echoue', erreur instanceof Error ? erreur.message : String(erreur));
    }
    this.#verifierFraicheur();
  }

  /**
   * Alerte de péremption : même un scheduler qui tourne toujours peut ne plus
   * jamais réussir (cible canari cassée, régression silencieuse du chemin).
   * `☠` Distincte d'un échec ponctuel : celle-ci se déclenche indépendamment du
   * résultat du tick courant, sur la seule ancienneté du dernier succès.
   */
  #verifierFraicheur(): void {
    if (this.#etat.dernierSuccesA === null) return; // déjà signalé par l'échec du tick courant
    const ecouleMs = this.#horloge() - this.#etat.dernierSuccesA;
    if (ecouleMs <= this.#seuilAlerteMs) return;
    this.#alerter({
      motif: 'drill_perime',
      detail: `dernier succès il y a ${ecouleMs} ms (seuil ${this.#seuilAlerteMs} ms) — le bouton d'arrêt d'urgence n'a pas été prouvé fonctionnel récemment`,
      depuisDernierSuccesMs: ecouleMs,
    });
  }

  #reussir(): void {
    const a = this.#horloge();
    this.#etat = { ...this.#etat, dernierSuccesA: a };
    arretUrgenceLogger.info({ missionIdCanari: this.#missionIdCanari }, 'drill arrêt urgence réussi (G.4.3)');
  }

  #echouer(motif: MotifAlerte, detail: string): void {
    const a = this.#horloge();
    this.#etat = { ...this.#etat, dernierEchec: { a, motif: detail } };
    arretUrgenceLogger.error({ motif, detail }, 'drill arrêt urgence en échec');
    const depuisDernierSuccesMs = this.#etat.dernierSuccesA === null ? null : a - this.#etat.dernierSuccesA;
    this.#alerter({ motif, detail, depuisDernierSuccesMs });
  }

  #alerter(alerte: AlerteDrill): void {
    try {
      this.#alerte(alerte);
    } catch (erreur) {
      arretUrgenceLogger.error({ err: erreur }, "le callback d'alerte a levé — ignoré, jamais bloquant");
    }
  }
}
