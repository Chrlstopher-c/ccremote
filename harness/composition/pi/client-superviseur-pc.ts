/**
 * Responsabilité : implémente `InventairePc & ReinitialisateurSession &
 * ArreteurMission & RelanceurMission` — les quatre ports que la
 * réconciliation (M-30) et le serveur MCP de contrôle (A.2) attendent
 * réellement câblés vers le PC.
 *
 * `☠ INVERSÉ (H-75)` — avant cette mission, ce fichier ouvrait une connexion
 * WS ÉPHÉMÈRE PAR APPEL vers un serveur hébergé sur le PC (`composition/pc/
 * serveur-controle.ts`, supprimé — le PC n'héberge plus rien). Ce module émet
 * maintenant une enveloppe `controle_requete` (`lien-pc-pi/protocole.ts`) sur
 * l'UNIQUE lien persistant Pi↔PC (`composition/pi/serveur-lien-pc.ts`,
 * `LienWebSocket`, symétrique) et attend la `controle_reponse` corrélée.
 *
 * Ce que ça change RÉELLEMENT (pas cosmétique) :
 *  - une seule connexion physique pour TOUTES les opérations, jamais une par
 *    appel — la reconnexion (backoff+gigue, ping/pong) est gérée UNE FOIS,
 *    par `LienWebSocket`, pas réimplémentée ici ;
 *  - pendant une coupure transitoire, une requête émise ici reste EN VOL :
 *    `CanalDonnees` (D.2.2) la rejoue à la reconnexion — ce module n'a rien à
 *    détecter lui-même, `CorrelateurReponses` attend juste plus longtemps ;
 *  - `inventaire()` PC absent depuis longtemps (H-75, tolérance à l'absence)
 *    n'est PAS distingué d'un PC temporairement lent : les deux finissent en
 *    `[]` après le délai, sans alarme différenciée — délibéré, voir le
 *    rapport de mission (« ce que le parent devra valider en réel »).
 *
 * `⚠` Limite héritée, INCHANGÉE par cette mission : `ReponseControle`
 * (superviseur/canal-controle.ts, hors zone) ne porte pas l'`opId` — c'est
 * pourquoi ce module fabrique lui-même l'`id` de corrélation (même valeur que
 * `opId`) plutôt que de dépendre du contrat `canal-controle.ts`. Contrairement
 * à l'ancienne version, plusieurs appels PEUVENT désormais être en vol
 * simultanément (le lien est partagé, pas une connexion par appel) : c'est
 * `CorrelateurReponses`, par `id`, qui les distingue — la sérialisation
 * artificielle de l'ancienne version n'est plus nécessaire.
 *
 * `☠ TROUVÉ EN ASSEMBLANT` — `versPc()` (`transport/lien-websocket.ts`, hors
 * zone) n'a AUCUN chemin de réception câblé : `#distribuer` ne traite QUE
 * `TAG.STDOUT` (livré à `#stdout`) ; `TAG.STDIN` (ce que `versPc().ecrire()`
 * envoie) tombe dans le `default` (« tag inconnu, ignoré ») sur le pair qui le
 * reçoit — vérifié en lisant `#distribuer` au grep. `versPc().surOctets()` ne
 * se déclenche donc JAMAIS, sur aucun des deux pairs. Ce module écrit ET lit
 * exclusivement via `versPi()` (`#stdout`, le seul chemin dont la RÉCEPTION
 * est câblée) — voir le rapport de mission, section « ce qui ne s'assemble
 * pas », pour la portée complète de ce défaut (il touche aussi le rejeu au
 * rattachement, `#stdout` n'étant jamais rejoué contrairement à `#stdin`).
 */

import type {
  DemandeEnAttenteReinitialisation,
  DescripteurWorkerPc,
  InventairePc,
  ReinitialisateurSession,
  ResultatReinitialisation,
} from '../../control-plane/reconciliation/index.ts';
import type { ArreteurMission, RelanceurMission } from '../../control-plane/orchestrateur/mcp-controle/types.ts';
import type {
  DemandeDemarrageTransportable,
  OperationControle,
  ReponseControle,
  TelemetrieWorker,
  JetonCompte,
} from '../../superviseur/index.ts';
import type { MetriquesHote } from '../../superviseur/metriques-hote.ts';
import type { ResultatExploration } from '../../superviseur/exploration-projets.ts';
import type { ResultatRecherche } from '../../superviseur/recherche-projets.ts';
import type { ResultatLectureFichier } from '../../superviseur/lecture-fichier.ts';
import type { Lien } from '../../transport/contrat.ts';
import { compositionLogger } from '../logger.ts';
import { CorrelateurReponses } from '../lien-pc-pi/correlateur.ts';
import { envoyerEnveloppe, surEnveloppe, type EnveloppeLien } from '../lien-pc-pi/protocole.ts';

const log = compositionLogger.child({ composant: 'client-superviseur-pc' });

export class ErreurClientSuperviseurPc extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurClientSuperviseurPc';
  }
}

export interface OptionsClientSuperviseurPc {
  readonly timeoutMs?: number;
}

const TIMEOUT_MS_DEFAUT = 10_000;

/**
 * Délai propre à `inspecter`. `☠` Toutes les autres opérations du canal sont des
 * lectures locales — inventaire, télémétrie, jetons — et 10 s y sont largement
 * confortables. L'inspection est la PREMIÈRE qui déclenche un appel de modèle
 * côté PC : mesuré en prod le 01/08, elle dépassait systématiquement le délai
 * commun, donc échouait en 500 sur le chemin parfaitement sain. Un budget de
 * latence hérité d'opérations locales ne s'applique pas à un appel distant.
 */
const TIMEOUT_INSPECTION_MS = 90_000;

function versDescripteurs(reponse: ReponseControle): readonly DescripteurWorkerPc[] {
  return reponse.inventaire ?? [];
}

function versDemandesEnAttente(reponse: ReponseControle): readonly DemandeEnAttenteReinitialisation[] {
  return reponse.demandesEnAttente ?? [];
}

/** Refus de lecture fabriqué côté Pi quand le PC n'a rien pu rendre. */
function refusLecture(chemin: string, note: string): ResultatLectureFichier {
  return { ok: false, racine: '', chemin, contenu: '', octets: 0, tronque: false, note };
}

/**
 * `lien` DOIT être L'INSTANCE réelle partagée avec `composition/pi/serveur-
 * lien-pc.ts` — jamais une nouvelle instance : elle ne verrait aucune
 * enveloppe déjà en transit sur le lien.
 */
export class ClientSuperviseurPc implements InventairePc, ReinitialisateurSession, ArreteurMission, RelanceurMission {
  readonly #timeoutMs: number;
  readonly #correlateur = new CorrelateurReponses<ReponseControle>();

  constructor(
    private readonly lien: Lien,
    options: OptionsClientSuperviseurPc = {},
  ) {
    this.#timeoutMs = options.timeoutMs ?? TIMEOUT_MS_DEFAUT;
    // `versPi()` des deux côtés (voir `☠ TROUVÉ EN ASSEMBLANT` en tête de fichier) :
    // seul chemin dont la réception est réellement câblée dans `transport/`.
    surEnveloppe(
      this.lien.versPi(),
      (enveloppe) => this.#surEnveloppeRecue(enveloppe),
      (erreur) => log.error({ err: erreur }, 'enveloppe illisible reçue du PC sur le lien de contrôle'),
    );
  }

  #surEnveloppeRecue(enveloppe: EnveloppeLien): void {
    if (enveloppe.kind !== 'controle_reponse') return; // `permission_demande` : géré par un autre abonné du même tuyau (permission-verdict-distant.ts).
    this.#correlateur.resoudre(enveloppe.id, enveloppe.reponse);
  }

  async #appeler(operation: OperationControle, timeoutMs?: number): Promise<ReponseControle> {
    const id = this.#correlateur.nouvelId();
    const attente = this.#correlateur.attendre(id, timeoutMs ?? this.#timeoutMs);
    envoyerEnveloppe(this.lien.versPi(), { kind: 'controle_requete', id, requete: { opId: id, operation } });
    return attente;
  }

  async inventaire(): Promise<readonly DescripteurWorkerPc[]> {
    try {
      const reponse = await this.#appeler({ type: 'inventaire' });
      return versDescripteurs(reponse);
    } catch (erreur) {
      log.error({ err: erreur }, "inventaire() du PC injoignable — traité comme vide, jamais comme une exception qui bloque la réconciliation");
      return [];
    }
  }

  /** Lecture pure de ce que le PC observe. PC absent ⇒ liste vide, jamais une exception. */
  async telemetrie(): Promise<readonly TelemetrieWorker[]> {
    try {
      const reponse = await this.#appeler({ type: 'telemetrie' });
      return reponse.telemetrie ?? [];
    } catch (erreur) {
      log.debug({ err: erreur }, 'télémétrie du PC indisponible — traitée comme vide');
      return [];
    }
  }

  /**
   * Jetons d'accès OAuth des comptes, relevés sur le PC. `☠` C'est le SEUL
   * moment où le PC est nécessaire à la mesure des quotas : le Pi sonde ensuite
   * l'endpoint OAuth lui-même, donc les jauges continuent de vivre PC éteint,
   * jusqu'à expiration du jeton (~8 h). PC absent ⇒ liste vide, le Pi garde les
   * jetons qu'il a déjà persistés.
   */
  async jetons(): Promise<readonly JetonCompte[]> {
    try {
      const reponse = await this.#appeler({ type: 'jetons' });
      return reponse.jetons ?? [];
    } catch (erreur) {
      log.debug({ err: erreur }, 'jetons du PC indisponibles — les derniers connus restent en vigueur');
      return [];
    }
  }

  /**
   * Ce que CETTE machine dit d'elle-même. `☠` Machine absente ⇒ `null`, jamais
   * un objet à zéros : « 0 % de CPU » et « je n'ai pas pu mesurer » mènent à des
   * lectures opposées, et c'est sur ces chiffres qu'on décide où lancer.
   */
  async metriquesHote(): Promise<MetriquesHote | null> {
    try {
      const reponse = await this.#appeler({ type: 'metriques_hote' });
      return reponse.metriquesHote ?? null;
    } catch (erreur) {
      log.debug({ err: erreur }, 'métriques de la machine indisponibles — traitées comme absentes');
      return null;
    }
  }

  /**
   * Demande au juge H-68 un avis sur-le-champ à propos d'une équipe.
   *
   * `☠` LÈVE quand le PC est absent, au lieu de rendre un verdict par défaut.
   * Tout le reste de ce client se replie en silence — c'est correct pour une
   * jauge qui vieillit, jamais pour un avis. Un « progrès » fabriqué sur une
   * panne de lien ferait laisser tourner l'équipe précisément quand on doutait
   * assez d'elle pour cliquer.
   */
  async inspecter(missionId: string): Promise<{ readonly verdict: string; readonly motif: string }> {
    const reponse = await this.#appeler({ type: 'inspecter', missionId }, TIMEOUT_INSPECTION_MS);
    if (reponse.inspection === undefined) {
      throw new Error(reponse.detail ?? 'le PC n’a rendu aucun verdict d’inspection');
    }
    return reponse.inspection;
  }

  /** Parcourt l'arborescence des projets du PC. PC absent ⇒ note explicite, jamais une liste vide muette. */
  async explorerProjets(chemin?: string): Promise<ResultatExploration> {
    try {
      const reponse = await this.#appeler({ type: 'explorer_projets', chemin });
      return (
        reponse.explorationProjets ?? {
          racine: '',
          chemin: chemin ?? '',
          entrees: [],
          note: reponse.detail ?? 'exploration indisponible',
        }
      );
    } catch (erreur) {
      log.warn({ err: erreur }, 'exploration des projets impossible — PC injoignable');
      return { racine: '', chemin: chemin ?? '', entrees: [], note: 'PC injoignable' };
    }
  }

  /**
   * Cherche un motif dans le contenu des projets DU PC.
   *
   * `☠` PC absent ⇒ note explicite, jamais une liste vide muette : « aucune
   * occurrence » et « je n'ai pas pu chercher » mènent à des décisions
   * opposées, et c'est précisément sur cette recherche que l'orchestrateur
   * cadre un mandat.
   */
  async rechercherProjets(motif: string, chemin?: string, max?: number): Promise<ResultatRecherche> {
    try {
      const reponse = await this.#appeler({ type: 'rechercher_projets', motif, chemin, max });
      return (
        reponse.rechercheProjets ?? {
          motif,
          chemin: chemin ?? '',
          occurrences: [],
          note: reponse.detail ?? 'recherche indisponible',
        }
      );
    } catch (erreur) {
      log.warn({ err: erreur, motif }, 'recherche dans les projets impossible — PC injoignable');
      return { motif, chemin: chemin ?? '', occurrences: [], note: 'PC injoignable — recherche non effectuée' };
    }
  }

  /**
   * Lit un fichier de projet SUR LE PC. `☠` PC absent ⇒ refus explicite portant
   * sa raison, jamais un contenu vide : une chaîne vide serait interprétée par
   * l'orchestrateur comme un fichier vide, et il conclurait sur du néant.
   */
  async lireFichier(chemin: string): Promise<ResultatLectureFichier> {
    try {
      const reponse = await this.#appeler({ type: 'lire_fichier', chemin });
      return reponse.lectureFichier ?? refusLecture(chemin, reponse.detail ?? 'lecture indisponible');
    } catch (erreur) {
      log.warn({ err: erreur, chemin }, 'lecture de fichier impossible — PC injoignable');
      return refusLecture(chemin, 'PC injoignable');
    }
  }

  async tuerSansPreavis(sessionId: string): Promise<void> {
    await this.#appeler({ type: 'tuer_sans_preavis', sessionId });
  }

  async reinitialiser(sessionId: string): Promise<ResultatReinitialisation> {
    const reponse = await this.#appeler({ type: 'reinitialiser', sessionId });
    return { demandesEnAttente: versDemandesEnAttente(reponse) };
  }

  /**
   * Démarre réellement une équipe sur le PC (H-61 : appelé UNIQUEMENT après
   * l'autorisation humaine d'un mandat, jamais par l'orchestrateur seul).
   */
  async demarrer(demande: DemandeDemarrageTransportable): Promise<{ readonly detail: string }> {
    const reponse = await this.#appeler({ type: 'demarrer_worker', demande });
    // `☠` Un refus du PC est une ERREUR, jamais un succès silencieux. Sans cette
    // garde (constaté en prod le 23/07), un worker qui n'avait pas démarré était
    // annoncé « équipe lancée » à l'opérateur, mandat consommé à l'appui.
    if (!reponse.ok) {
      throw new Error(reponse.detail ?? "le PC a refusé de démarrer l'équipe");
    }
    return { detail: reponse.detail ?? 'équipe démarrée' };
  }

  async arreter(missionId: string): Promise<void> {
    await this.#appeler({ type: 'arreter_worker', missionId });
  }

  async relancer(missionId: string, sessionId: string): Promise<{ readonly dejaVivant: boolean }> {
    const reponse = await this.#appeler({ type: 'relancer_worker', missionId, sessionId });
    if (!reponse.ok) throw new Error(reponse.detail ?? 'la machine a refusé de relancer la session');
    return { dejaVivant: reponse.relanceIgnoree === true };
  }

  // -- Pilotage d'une mission vivante (A.2.2) ---------------------------------
  // `☠` Ces trois ordres traversent le MÊME lien que le reste (H-75). Ils ne
  // passent jamais par l'orchestrateur : l'opérateur pilote directement, même
  // si la session maître est saturée ou absente.

  /**
   * `☠` Le refus de la machine est RELEVÉ ici (`reponse.ok`), pas ignoré. Sans
   * ce test, un superviseur sans pilotage câblé répondait `refuse` et l'appelant
   * — interface comme orchestrateur — annonçait « instruction transmise ». Même
   * famille que le port non câblé qui rendait `envoyer_a_equipe` menteur.
   */
  async envoyerInstruction(missionId: string, texte: string): Promise<{ readonly detail: string }> {
    const reponse = await this.#appeler({ type: 'envoyer_instruction', missionId, texte });
    if (!reponse.ok) throw new Error(reponse.detail ?? "la machine a refusé de transmettre l'instruction");
    return { detail: reponse.detail ?? '' };
  }

  async interrompre(missionId: string): Promise<void> {
    const reponse = await this.#appeler({ type: 'interrompre_worker', missionId });
    if (!reponse.ok) throw new Error(reponse.detail ?? 'la machine a refusé d’interrompre le tour en cours');
  }

  async mettreEnPause(missionId: string): Promise<void> {
    await this.#appeler({ type: 'pause_worker', missionId });
  }

  async reprendre(missionId: string): Promise<void> {
    await this.#appeler({ type: 'reprendre_worker', missionId });
  }
}
