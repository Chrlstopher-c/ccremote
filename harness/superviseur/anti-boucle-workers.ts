/**
 * Responsabilité : câblage du juge anti-boucle (H-68, mission M-53) sur le seul point qui
 * observe des `SDKResultMessage` réels et détient `arreter()` par mission —
 * `SuperviseurWorkers.#surveillerResultats()`. Toute la logique vit ICI, jamais dans
 * `superviseur-workers.ts` (499/500 lignes) : celui-ci ne fait qu'appeler `CablageAntiBoucle`.
 *
 * `☠ H-74` — le port `JugeBoucle` devrait être obligatoire. Il reste optionnel ici
 * UNIQUEMENT parce que tous les sites d'appel actuels de `SuperviseurWorkers` sont des tests
 * préexistants hors périmètre de cette mission (aucun appelant de production n'existe encore
 * — vérifié par grep). Modifier ~40 sites de test non liés à l'anti-boucle pour satisfaire un
 * type strict aurait dépassé le périmètre `superviseur/` de cette mission et heurté
 * l'interdiction de modifier des tests existants. C'est donc le cas « optionalité vraiment
 * inévitable » que H-74 prévoit explicitement : l'absence est rendue BRUYANTE
 * (`superviseurLogger.warn` au démarrage, nommant le garde-fou inactif) plutôt que silencieuse
 * — et le repli ne rend jamais qu'`incertain`, donc ne coupe et n'escalade jamais tout seul.
 * Tout nouveau site de production doit fournir un vrai `JugeBoucle` — ne pas s'appuyer sur ce
 * repli au-delà des tests.
 *
 * `☠` Biais asymétrique (H-68) non négociable, câblé ici : seul un verdict `boucle` coupe.
 * `incertain` ne coupe jamais, même répété — il escalade (H-61) au bout de N paliers
 * consécutifs, sans jamais couper de lui-même. `progres` et tout palier non franchi laissent
 * la politique de relance existante (`deciderRelance`) totalement inchangée.
 *
 * `☠` Non-bloquant par construction : `evaluerEtAppliquer` n'est appelé qu'au moment du
 * `SDKResultMessage` — le DERNIER message d'un segment (mesuré : un `result` ferme tout le
 * process). Il n'est donc jamais entrelacé avec l'observation d'un tour en cours (piège
 * H-72.3 : un appel de contrôle entrelacé avec la lecture du flux fait perdre des messages).
 * Le juge peut prendre jusqu'à son propre timeout sans retarder l'observation de quoi que ce
 * soit d'autre : il n'y a plus rien à observer dans ce segment au moment où il est appelé.
 * Toute panne (juge, accumulation) est capturée ici et replie sur « ne rien casser » — jamais
 * de coupure/escalade sur une panne de plomberie de ce câblage lui-même.
 */

import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  deciderCoupure,
  ETAT_ESCALADE_INITIAL,
  ETAT_PALIERS_INITIAL,
  extraireSignaux,
  PALIERS_PAR_DEFAUT,
  SEUIL_ESCALADE_INCERTAINS_PAR_DEFAUT,
  verifierPalier,
  type ActionCoupure,
  type ConfigPaliers,
  type DecisionCoupure,
  type EtatEscalade,
  type EtatPaliers,
  type FichierModifie,
  type JugeBoucle,
  type OutilAppele,
  type ResumeTour,
  type VerdictJuge,
} from '../anti-boucle/index.ts';
import { missionLogger, superviseurLogger } from './logger.ts';

/** Fenêtre glissante de tours conservés par mission — borne le coût de `extraireSignaux` (H-68 : bon marché). */
const FENETRE_TOURS_MAX = 20;

interface TourMutable {
  index: number;
  outils: OutilAppele[];
  erreur: string | null;
  fichiersModifies: FichierModifie[];
  testsEchoues: string[];
}

/** État accumulé pour UNE mission — même durée de vie que `CompteurRelances` (clé stable across resumes). */
interface EtatMissionAntiBoucle {
  paliers: EtatPaliers;
  escalade: EtatEscalade;
  coutCumuleUsd: number;
  prochainIndexTour: number;
  tours: TourMutable[];
  toolUseEnAttente: Map<string, TourMutable>;
}

function etatMissionInitial(): EtatMissionAntiBoucle {
  return {
    paliers: ETAT_PALIERS_INITIAL,
    escalade: ETAT_ESCALADE_INITIAL,
    coutCumuleUsd: 0,
    prochainIndexTour: 0,
    tours: [],
    toolUseEnAttente: new Map(),
  };
}

/** Registre par mission (H-68 : « même durée de vie que le compteur de relances existant »). */
class EtatsAntiBoucle {
  readonly #etats = new Map<string, EtatMissionAntiBoucle>();

  pour(missionId: string): EtatMissionAntiBoucle {
    const existant = this.#etats.get(missionId);
    if (existant !== undefined) return existant;
    const initial = etatMissionInitial();
    this.#etats.set(missionId, initial);
    return initial;
  }
}

export interface ConfigAntiBoucle {
  readonly paliers?: ConfigPaliers;
  readonly seuilEscaladeIncertains?: number;
}

/** Port d'observation/audit (même motif best-effort que `ObservateurRelance`, H-64 : trace dans le fil). */
export interface ObservateurAntiBoucle {
  surDecision(missionId: string, decision: DecisionCoupure): void;
}

function cibleDepuisInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (typeof input !== 'object' || input === null) return '';
  const objet = input as Record<string, unknown>;
  const candidat = objet['file_path'] ?? objet['path'] ?? objet['command'] ?? objet['pattern'] ?? objet['url'];
  if (typeof candidat === 'string') return candidat;
  try {
    return JSON.stringify(input).slice(0, 80);
  } catch {
    return '';
  }
}

/** Hash court non cryptographique — jamais le contenu lui-même (contrat `FichierModifie`, anti-boucle/types.ts). */
function empreinteCourte(valeur: string): string {
  let h = 0;
  for (let i = 0; i < valeur.length; i += 1) h = (Math.imul(31, h) + valeur.charCodeAt(i)) | 0;
  return h.toString(16);
}

const OUTILS_ECRITURE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function narrowerBlocs(contenu: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(contenu)) return [];
  return (contenu as unknown[]).filter((bloc): bloc is Record<string, unknown> => typeof bloc === 'object' && bloc !== null);
}

/**
 * Démarre un nouveau tour à chaque message assistant. `⚠ HYP` — un même tour API peut, sur
 * `resumed_from_incomplete_thinking`, produire plusieurs messages partageant un `message.id`
 * (non fusionnés ici, simplification assumée) : sur-compte plutôt que sous-compte les tours,
 * sens sûr pour un signal d'alerte (plus de granularité, jamais moins de vigilance).
 */
function ingererMessageAssistant(etat: EtatMissionAntiBoucle, message: Extract<SDKMessage, { type: 'assistant' }>): void {
  const tour: TourMutable = { index: etat.prochainIndexTour, outils: [], erreur: null, fichiersModifies: [], testsEchoues: [] };
  etat.prochainIndexTour += 1;

  for (const bloc of narrowerBlocs(message.message.content)) {
    if (bloc['type'] !== 'tool_use') continue;
    const id = bloc['id'];
    const nom = bloc['name'];
    if (typeof id !== 'string' || typeof nom !== 'string') continue;
    const cible = cibleDepuisInput(bloc['input']);
    tour.outils.push({ nom, cible });
    if (OUTILS_ECRITURE.has(nom) && cible !== '') {
      tour.fichiersModifies.push({ chemin: cible, empreinte: empreinteCourte(JSON.stringify(bloc['input'] ?? null)) });
    }
    etat.toolUseEnAttente.set(id, tour);
  }

  etat.tours.push(tour);
  if (etat.tours.length > FENETRE_TOURS_MAX) etat.tours.shift();
}

/**
 * Rattache un `tool_result` en erreur au tour qui a émis le `tool_use` correspondant.
 * `⚠` Détection des tests échoués volontairement absente (dette assumée) : parser la sortie
 * d'un outil `Bash` pour distinguer un test qui échoue d'un texte qui en parle est fragile et
 * hors périmètre de cette mission — signal laissé vide plutôt que deviné (sens sûr : un signal
 * manquant rend le juge moins sensible, jamais plus coupant).
 */
function ingererMessageUtilisateur(etat: EtatMissionAntiBoucle, message: Extract<SDKMessage, { type: 'user' }>): void {
  for (const bloc of narrowerBlocs(message.message.content)) {
    if (bloc['type'] !== 'tool_result' || bloc['is_error'] !== true) continue;
    const toolUseId = bloc['tool_use_id'];
    if (typeof toolUseId !== 'string') continue;
    const tour = etat.toolUseEnAttente.get(toolUseId);
    if (tour === undefined) continue;
    tour.erreur = typeof bloc['content'] === 'string' ? bloc['content'].slice(0, 200) : 'erreur outil (contenu non textuel)';
  }
}

/** Accumule les signaux d'UN message déjà lu par l'unique consommateur — jamais de relecture du transcript (H-68). */
function accumulerPourAntiBoucle(etat: EtatMissionAntiBoucle, message: SDKMessage): void {
  if (message.type === 'assistant') {
    ingererMessageAssistant(etat, message);
  } else if (message.type === 'user') {
    ingererMessageUtilisateur(etat, message);
  }
}

function versResumeTour(tour: TourMutable): ResumeTour {
  return { index: tour.index, outils: tour.outils, erreur: tour.erreur, fichiersModifies: tour.fichiersModifies, testsEchoues: tour.testsEchoues };
}

/**
 * `⚠ HYP` non vérifiée (interdiction de session réelle sur cette mission) : `total_cost_usd`
 * d'un `SDKResultMessage` est traité ici comme un DELTA de segment et sommé sur toute la durée
 * de vie de la mission (across resumes, B.3.3). Lecture alternative possible : le SDK pourrait
 * déjà rendre un total cumulatif sur une session reprise (`resume`), auquel cas cette somme
 * SUR-COMPTERAIT le coût réel — ce qui rendrait les paliers H-68 trop sensibles (inspections
 * plus fréquentes que nécessaire), jamais trop permissifs (jamais l'inverse : sur-compter le
 * coût ne peut que déclencher le juge PLUS tôt, jamais plus tard). Sens sûr, mais à mesurer
 * sur banc réel avant de figer les paliers en production.
 */
function verifierEtJuger(
  etat: EtatMissionAntiBoucle,
  message: SDKResultMessage,
  jugeBoucle: JugeBoucle,
  missionId: string,
  config: ConfigAntiBoucle,
): Promise<DecisionCoupure | null> {
  const log = missionLogger(missionId);
  const configPaliers = config.paliers ?? PALIERS_PAR_DEFAUT;
  const seuilEscalade = config.seuilEscaladeIncertains ?? SEUIL_ESCALADE_INCERTAINS_PAR_DEFAUT;

  etat.coutCumuleUsd += message.total_cost_usd;
  const declenchement = verifierPalier(etat.coutCumuleUsd, configPaliers, etat.paliers);
  etat.paliers = declenchement.nouvelEtat;
  if (!declenchement.declenche || declenchement.palierUsd === null) return Promise.resolve(null);

  log.warn({ palierUsd: declenchement.palierUsd, coutCumuleUsd: etat.coutCumuleUsd }, 'palier anti-boucle franchi (H-68) — inspection par le juge');

  const signaux = extraireSignaux(etat.tours.map(versResumeTour));
  const palierUsd = declenchement.palierUsd;
  return jugeBoucle
    .juger(signaux, { missionId, palierUsd, coutCourantUsd: etat.coutCumuleUsd })
    .then((verdict) => {
      const resultat = deciderCoupure(verdict, etat.escalade, seuilEscalade);
      etat.escalade = resultat.nouvelEtat;
      log.info({ action: resultat.decision.action, motif: resultat.decision.motif }, 'décision anti-boucle appliquée (H-68)');
      return resultat.decision;
    })
    .catch((erreur: unknown) => {
      // `☠` Défense en profondeur : `creerJugeHaiku()` replie déjà sur `incertain` en interne
      // (`juge-haiku.ts`). Cette capture couvre un port injecté (test, ou implémentation
      // future) qui lèverait au lieu de replier — même comportement de sûreté, jamais bloquant.
      log.error({ err: erreur }, 'le juge anti-boucle a levé au-dessus du port — aucune coupure, jamais bloquant (H-68)');
      return null;
    });
}

function jugeBouclePorteBruyante(): JugeBoucle {
  return {
    juger: () =>
      Promise.resolve({
        verdict: 'incertain' as const,
        motif: "JugeBoucle non fourni au superviseur (H-74) — repli de sûreté, aucune coupure automatique possible",
      }),
  };
}

export interface DependancesCablageAntiBoucle {
  readonly jugeBoucle?: JugeBoucle;
  readonly config?: ConfigAntiBoucle;
  readonly observateur?: ObservateurAntiBoucle;
}

/** Fabrique à partir de `DependancesSuperviseur` — un seul appel côté `superviseur-workers.ts` (limite 500 lignes). */
export function creerCablageAntiBoucle(deps: {
  readonly jugeBoucle?: JugeBoucle;
  readonly configAntiBoucle?: ConfigAntiBoucle;
  readonly observateurAntiBoucle?: ObservateurAntiBoucle;
}): CablageAntiBoucle {
  return new CablageAntiBoucle({ jugeBoucle: deps.jugeBoucle, config: deps.configAntiBoucle, observateur: deps.observateurAntiBoucle });
}

/**
 * Point d'intégration unique appelé depuis `SuperviseurWorkers` : deux méthodes, `accumuler`
 * (à chaque message) et `evaluerEtAppliquer` (au `SDKResultMessage`). Toute la mécanique H-68
 * (paliers, signaux, juge, biais asymétrique, garde-fou H-74) est encapsulée ici — le
 * superviseur ne connaît que ces deux appels.
 */
export class CablageAntiBoucle {
  readonly #etats = new EtatsAntiBoucle();
  readonly #jugeBoucle: JugeBoucle;
  readonly #config: ConfigAntiBoucle;
  readonly #observateur: ObservateurAntiBoucle | undefined;

  constructor(deps: DependancesCablageAntiBoucle = {}) {
    this.#config = deps.config ?? {};
    this.#observateur = deps.observateur;
    if (deps.jugeBoucle === undefined) {
      superviseurLogger.warn(
        'garde-fou anti-boucle (H-68) INACTIF : aucun JugeBoucle fourni au superviseur — repli sur un juge de ' +
          'sûreté qui ne rend jamais que « incertain » (jamais de coupure ni d’escalade automatique). Corriger le ' +
          'site d’appel de SuperviseurWorkers dès que possible (H-74).',
      );
      this.#jugeBoucle = jugeBouclePorteBruyante();
    } else {
      this.#jugeBoucle = deps.jugeBoucle;
    }
  }

  /** À appeler pour CHAQUE message lu par l'unique consommateur, avant toute autre interprétation. */
  accumuler(missionId: string, message: SDKMessage): void {
    try {
      accumulerPourAntiBoucle(this.#etats.pour(missionId), message);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, 'accumulation anti-boucle en échec — ignorée, jamais bloquant (H-68)');
    }
  }

  /**
   * À appeler UNE FOIS par `SDKResultMessage` reçu (fin de segment), avant toute décision de
   * relance. Rend `null` si aucun palier n'est franchi (comportement de relance inchangé) ou
   * l'action décidée. Sur `'couper'`, appelle `arreterMission` fourni par l'appelant — jamais
   * un import direct de `SuperviseurWorkers.arreter()` pour ne pas coupler ce module à sa forme.
   */
  async evaluerEtAppliquer(
    missionId: string,
    message: SDKResultMessage,
    arreterMission: (missionId: string) => Promise<void>,
  ): Promise<ActionCoupure | null> {
    const log = missionLogger(missionId);
    try {
      const decision = await verifierEtJuger(this.#etats.pour(missionId), message, this.#jugeBoucle, missionId, this.#config);
      if (decision === null) return null;
      this.#notifier(missionId, decision);
      if (decision.action === 'couper') {
        log.warn({ motif: decision.motif }, 'garde-fou anti-boucle : coupure décidée (H-68)');
        await arreterMission(missionId);
      }
      return decision.action;
    } catch (erreur) {
      log.error({ err: erreur }, 'évaluation anti-boucle en échec — aucune coupure, jamais bloquant (H-68)');
      return null;
    }
  }

  /**
   * Inspection À LA DEMANDE — l'opérateur veut un avis, maintenant.
   *
   * `☠` Elle ne coupe JAMAIS, quel que soit le verdict, et ne consomme aucun
   * palier. Deux raisons également décisives : on clique ce bouton quand on
   * DOUTE, pas quand on veut tuer — un effet de bord mortel sur un geste de
   * curiosité est le pire contrat possible ; et consommer un palier ferait
   * sauter une inspection automatique plus tard, en échange de rien.
   * L'interface propose l'arrêt sur un verdict `boucle`, l'opérateur confirme.
   *
   * `☠` Utilisable PENDANT un tour, précisément là où l'automatique est aveugle :
   * `etat.tours` est alimenté à CHAQUE message assistant, jamais au seul
   * `result`. Les signaux sont donc déjà frais — c'est le déclencheur qui
   * manquait, pas la matière.
   */
  async inspecterMaintenant(missionId: string): Promise<VerdictJuge> {
    const log = missionLogger(missionId);
    const etat = this.#etats.pour(missionId);
    const signaux = extraireSignaux(etat.tours.map(versResumeTour));
    log.info({ tours: etat.tours.length, coutCumuleUsd: etat.coutCumuleUsd }, 'inspection demandée par l’opérateur (H-68)');
    try {
      const verdict = await this.#jugeBoucle.juger(signaux, {
        missionId,
        // `☠` Le coût courant, pas un palier : aucun n'est franchi ici. Le juge a
        // besoin d'un nombre pour motiver son prompt, pas d'un seuil fictif qui
        // lui laisserait croire à un déclenchement automatique.
        palierUsd: etat.coutCumuleUsd,
        coutCourantUsd: etat.coutCumuleUsd,
      });
      log.info({ verdict: verdict.verdict }, 'inspection à la demande — verdict rendu, aucune coupure');
      return verdict;
    } catch (erreur) {
      // `☠` Un juge injoignable rend « incertain », jamais « progrès » : un avis
      // rassurant fabriqué sur une panne est pire que pas d'avis du tout.
      log.error({ err: erreur }, 'inspection à la demande en échec — verdict « incertain » rendu');
      return {
        verdict: 'incertain',
        motif: `le juge n’a pas pu être interrogé : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      };
    }
  }

  #notifier(missionId: string, decision: DecisionCoupure): void {
    try {
      this.#observateur?.surDecision(missionId, decision);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "l'observateur anti-boucle a levé — ignoré, jamais bloquant");
    }
  }
}
