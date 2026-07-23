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
  QuotaCompteMesure,
} from '../../superviseur/index.ts';
import type { ResultatExploration } from '../../superviseur/exploration-projets.ts';
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

function versDescripteurs(reponse: ReponseControle): readonly DescripteurWorkerPc[] {
  return reponse.inventaire ?? [];
}

function versDemandesEnAttente(reponse: ReponseControle): readonly DemandeEnAttenteReinitialisation[] {
  return reponse.demandesEnAttente ?? [];
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

  async #appeler(operation: OperationControle): Promise<ReponseControle> {
    const id = this.#correlateur.nouvelId();
    const attente = this.#correlateur.attendre(id, this.#timeoutMs);
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
   * Usage des fenêtres de rate limit, mesuré par le PC. PC absent ⇒ liste vide :
   * les jauges gardent alors leur dernière valeur connue au registre, elles ne
   * retombent pas à zéro.
   */
  async quotas(): Promise<readonly QuotaCompteMesure[]> {
    try {
      const reponse = await this.#appeler({ type: 'quotas' });
      return reponse.quotas ?? [];
    } catch (erreur) {
      log.debug({ err: erreur }, 'quotas du PC indisponibles — dernières valeurs conservées');
      return [];
    }
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

  async relancer(missionId: string, sessionId: string): Promise<void> {
    await this.#appeler({ type: 'relancer_worker', missionId, sessionId });
  }

  // -- Pilotage d'une mission vivante (A.2.2) ---------------------------------
  // `☠` Ces trois ordres traversent le MÊME lien que le reste (H-75). Ils ne
  // passent jamais par l'orchestrateur : l'opérateur pilote directement, même
  // si la session maître est saturée ou absente.

  async envoyerInstruction(missionId: string, texte: string): Promise<{ readonly detail: string }> {
    const reponse = await this.#appeler({ type: 'envoyer_instruction', missionId, texte });
    return { detail: reponse.detail ?? '' };
  }

  async mettreEnPause(missionId: string): Promise<void> {
    await this.#appeler({ type: 'pause_worker', missionId });
  }

  async reprendre(missionId: string): Promise<void> {
    await this.#appeler({ type: 'reprendre_worker', missionId });
  }
}
