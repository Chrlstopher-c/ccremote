/**
 * Responsabilité : canari RÉEL pour le drill d'arrêt d'urgence (dette n°2,
 * TODO.md — « le drill n'est branché sur aucun canari réel »).
 *
 * Implémente `PortDrillArretUrgence` (le même port que consomme
 * `VerificateurDrillArretUrgence`) sans jamais passer par une session Claude
 * Code réelle : la cible est un process OS trivial (`sleep`, sans effet de
 * bord), démarré par ce module, jamais une doublure en mémoire.
 *
 * ☠ Portée du kill : jamais un motif de commande générique (`pkill -f sleep`
 * tuerait tout process du parc qui dort). La cible est identifiée UNIQUEMENT
 * par le PID exact obtenu au démarrage (`Bun.spawn(...).pid`), jamais par nom
 * de commande — cf. piège vécu ailleurs sur le parc (pkill générique ayant tué
 * un service tiers sans rapport).
 *
 * ☠ Isolation structurelle vis-à-vis d'une mission réelle : cette classe
 * n'importe RIEN de `superviseur/` (ni `RegistreWorkers`, ni
 * `SuperviseurWorkers`, ni leurs types). Elle ne connaît qu'un unique champ
 * privé, `#canari`, peuplé exclusivement par son propre `demarrerCanari()`.
 * `arreterMissionEnUrgence()` ne peut donc matcher que l'identifiant qu'elle a
 * elle-même généré — il n'existe aucun chemin de code par lequel un
 * `missionId` réel pourrait atteindre le PID d'un vrai worker. L'absence
 * totale d'import est la garantie, pas une convention.
 *
 * La mort n'est jamais supposée : elle est constatée en lisant `/proc/<pid>`
 * après le forçage, jamais en se fiant au seul fait que `kill()` n'a pas levé
 * (un signal peut être envoyé avec succès à un process qui l'ignore ou qui
 * met du temps à mourir).
 *
 * Ce que ce canari N'exerce PAS : la vraie séquence de production
 * (`SuperviseurWorkers.arreterMissionEnUrgence` — pause globale via
 * `ControleurPause`, `interrupt()` SDK, `RegistreWorkers`). Cette séquence
 * dépend d'une session Claude Code réelle, hors périmètre de ce module par
 * interdiction explicite de la mission. Ce canari exerce le SEUL sous-ensemble
 * transposable à un process OS nu : signaler → attendre la grâce → forcer →
 * constater la mort réelle.
 */

import { access } from 'node:fs/promises';
import { arretUrgenceLogger } from './logger.ts';
import { ETAPE_PREUVE_COMPLETE } from './types.ts';
import type { PortDrillArretUrgence } from './types.ts';

const PREFIXE_MISSION_CANARI = 'canari-arret-urgence-';
const COMMANDE_CANARI_DEFAUT: readonly string[] = ['sleep', '3600'];
const TIMEOUT_CONSTAT_MORT_MS_DEFAUT = 5000;
const INTERVALLE_SONDAGE_MS = 20;

interface EtatCanari {
  readonly missionId: string;
  readonly pid: number;
  readonly exited: Promise<number>;
}

export interface OptionsCanariProcess {
  /** Commande du process trivial. Doit être un process qui ne se termine pas seul avant le drill. */
  readonly commande?: readonly string[];
  /** Délai maximum pour constater la mort après forçage, avant d'abandonner (fuite signalée). */
  readonly timeoutConstatMortMs?: number;
}

async function procExiste(pid: number): Promise<boolean> {
  try {
    await access(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms));
}

/**
 * Sonde `/proc/<pid>` jusqu'à constater l'absence, ou jusqu'au timeout.
 * C'est la seule source de vérité de ce module sur la mort du canari — jamais
 * le code de retour de `kill()`, jamais la seule promesse `exited` de Bun.
 */
async function attendreMortConstatee(pid: number, timeoutMs: number): Promise<boolean> {
  const echeance = Date.now() + timeoutMs;
  for (;;) {
    if (!(await procExiste(pid))) return true;
    if (Date.now() >= echeance) return !(await procExiste(pid));
    await attendre(INTERVALLE_SONDAGE_MS);
  }
}

/**
 * Implémentation de `PortDrillArretUrgence` adossée à un vrai process OS.
 * Un seul canari vivant à la fois : `demarrerCanari()` nettoie tout
 * précédent avant d'en lancer un nouveau (jamais d'accumulation de fuite
 * entre deux exécutions du drill).
 */
export class PortDrillCanariProcess implements PortDrillArretUrgence {
  readonly #commande: readonly string[];
  readonly #timeoutConstatMortMs: number;
  #canari: EtatCanari | null = null;

  constructor(options: OptionsCanariProcess = {}) {
    this.#commande = options.commande ?? COMMANDE_CANARI_DEFAUT;
    this.#timeoutConstatMortMs = options.timeoutConstatMortMs ?? TIMEOUT_CONSTAT_MORT_MS_DEFAUT;
  }

  /**
   * Démarre un nouveau canari et retourne son `missionId` (à passer tel quel
   * à `VerificateurDrillArretUrgence` comme `missionIdCanari`). Nettoie
   * d'abord tout canari précédent resté en vie (drill précédent en échec).
   */
  async demarrerCanari(): Promise<string> {
    await this.#nettoyerCanariExistant();
    const missionId = `${PREFIXE_MISSION_CANARI}${crypto.randomUUID()}`;
    try {
      const proc = Bun.spawn({ cmd: [...this.#commande], stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
      this.#canari = { missionId, pid: proc.pid, exited: proc.exited };
      arretUrgenceLogger.info({ missionId, pid: proc.pid }, 'canari arrêt urgence : démarré');
      return missionId;
    } catch (erreur) {
      arretUrgenceLogger.error({ err: erreur }, 'canari arrêt urgence : échec du démarrage');
      throw erreur;
    }
  }

  /**
   * Satisfait `PortDrillArretUrgence`. Ne matche QUE le canari qu'elle a
   * elle-même démarré (isolation structurelle, voir en-tête de fichier) :
   * tout autre `missionId`, y compris une vraie mission, retourne `null`
   * comme « cible introuvable » — jamais une action sur un PID arbitraire.
   */
  async arreterMissionEnUrgence(
    missionId: string,
    graceMs = 5000,
  ): Promise<{ readonly missionId: string; readonly sessionId: string; readonly etapes: readonly string[] } | null> {
    const canari = this.#canari;
    if (canari === null || canari.missionId !== missionId) return null;

    const etapes: string[] = [];
    try {
      try {
        process.kill(canari.pid, 'SIGTERM');
        etapes.push('fermeture_propre');
      } catch (erreur) {
        arretUrgenceLogger.error({ err: erreur, pid: canari.pid }, 'canari : SIGTERM en échec, on poursuit vers le forçage');
      }

      await attendre(graceMs);

      if (await procExiste(canari.pid)) {
        try {
          process.kill(canari.pid, 'SIGKILL');
        } catch (erreur) {
          arretUrgenceLogger.error({ err: erreur, pid: canari.pid }, 'canari : SIGKILL en échec');
        }
      }

      const mortConstatee = await attendreMortConstatee(canari.pid, this.#timeoutConstatMortMs);
      if (mortConstatee) {
        etapes.push(ETAPE_PREUVE_COMPLETE);
        arretUrgenceLogger.info({ pid: canari.pid }, 'canari : mort constatée par /proc (preuve réelle, pas supposée)');
      } else {
        arretUrgenceLogger.error({ pid: canari.pid }, 'canari : toujours vivant après forçage — fuite de process possible');
      }

      return { missionId, sessionId: `pid-${canari.pid}`, etapes };
    } finally {
      // Nettoyage garanti même en cas d'échec au-dessus : ce canari ne doit
      // jamais rester référencé une fois la séquence tentée, réussie ou non.
      this.#canari = null;
      await this.#reaper(canari.pid, canari.exited);
    }
  }

  /** Force-tue et oublie tout canari resté en vie, sans tenter la séquence complète. Pour teardown. */
  async fermer(): Promise<void> {
    await this.#nettoyerCanariExistant();
  }

  /** Introspection pure (tests/observabilité) : ne permet aucune action, juste lire le PID courant. */
  pidCanariActuel(): number | null {
    return this.#canari?.pid ?? null;
  }

  async #nettoyerCanariExistant(): Promise<void> {
    const canari = this.#canari;
    if (canari === null) return;
    arretUrgenceLogger.warn({ missionId: canari.missionId, pid: canari.pid }, 'canari : nettoyage d’un canari orphelin resté en vie');
    this.#canari = null;
    try {
      if (await procExiste(canari.pid)) process.kill(canari.pid, 'SIGKILL');
    } catch (erreur) {
      arretUrgenceLogger.error({ err: erreur, pid: canari.pid }, 'canari : échec du SIGKILL de nettoyage');
    }
    await this.#reaper(canari.pid, canari.exited);
  }

  /** Attend la fin réelle du process (évite un zombie) — best-effort, jamais bloquant indéfiniment. */
  async #reaper(pid: number, exited: Promise<number>): Promise<void> {
    try {
      await Promise.race([exited, attendre(this.#timeoutConstatMortMs)]);
    } catch (erreur) {
      arretUrgenceLogger.error({ err: erreur, pid }, 'canari : erreur en attendant la fin réelle du process (ignorée)');
    }
  }
}
