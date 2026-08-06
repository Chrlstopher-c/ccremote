/**
 * Responsabilité : le superviseur de workers, côté PC (branche B, mission M-13).
 *
 * Implémentation RÉELLE des ports déclarés comme contrats ailleurs — jamais une
 * redéfinition : `InventairePc`/`ReinitialisateurSession` (`control-plane/
 * reconciliation/types.ts`, M-30), `RepertoireCibles`/`ArreteurMission`/
 * `RelanceurMission` (`mcp-controle/types.ts`, A.2).
 *
 * ☠ Frontière A↔B inexistante (03-couche-1.md) : ce module ne connaît rien du
 * registre SQLite du Pi. Tout ce qu'il sait vient de `DemandeDemarrage` (fourni au
 * dispatch) et de ce qu'il observe lui-même sur le `Query` du worker.
 *
 * **`deciderRelance()` (dette M-34)** : seul endroit du harness qui lit les
 * `SDKResultMessage` réels (`#surveillerResultats`) — chaque issue de tour est un
 * CHOIX : relancer ou remonter.
 *
 * `☠ CORRIGÉ LE 23/07` — l'en-tête affirmait ici qu'« un `result` ferme tout le
 * process (mesuré) ». C'est FAUX en streaming input, et cette croyance coûtait
 * des équipes entières : le module marquait le worker mort au premier `result`.
 * Banc réel : après `result n°1`, le SDK émet `background_tasks_changed`, une
 * `task_notification`, un nouvel `init`, et le lead REPART SEUL avec le résultat
 * de son sous-agent jusqu'à un `result n°2` ; le flux ne se termine jamais. La
 * mesure d'origine valait pour un prompt unique, pas pour une session pilotée
 * par un générateur d'entrée — qui est notre cas.
 *
 * **Idempotence** (D.3.1/D.3.2) : NATURELLE ici (rejouer `arreter`/`relancer`/
 * `tuerSansPreavis` sur un worker déjà dans l'état visé est un no-op, vérifié
 * AVANT tout effet). L'idempotence PAR IDENTIFIANT (dédup d'un rejeu exact) est
 * portée par `canal-controle.ts` au-dessus — les deux se combinent.
 *
 * **Fencing par epoch** (D.2.3, M-11, panne #2) : `demarrer()` est le SEUL point
 * qui revendique un worktree. Même epoch ou inférieur ⇒ REFUSÉ avant tout effet.
 * Epoch strictement supérieur ⇒ accepté, détenteurs périmés du MÊME worktree
 * RÉELLEMENT terminés via `tuerSansPreavis` (même chemin que l'arrêt d'urgence).
 */

import { creerCablageAntiBoucle, type CablageAntiBoucle } from './anti-boucle-workers.ts';
import { arbitrerFencingWorktree } from './fencing-arbitrage-workers.ts';
import { deciderRelance } from '../relance/politique-relance.ts';
import { sonderQuotas } from './sonde-quotas.ts';
import type { JetonCompte } from './sonde-quotas-http.ts';
import { lireJetonsComptes } from './jetons-comptes.ts';
import { lireSousAgents } from './sous-agents-disque.ts';
import { CollecteurTelemetrie } from './collecteur-telemetrie.ts';
import type { TelemetrieWorker } from './types.ts';
import { estDansRacine, explorerProjets, type ResultatExploration } from './exploration-projets.ts';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rechercherDansProjets, type ResultatRecherche } from './recherche-projets.ts';
import { lireFichier, type ResultatLectureFichier } from './lecture-fichier.ts';
import type { CompteurRelances } from '../relance/compteur-relances.ts';
import type { DecisionRelance } from '../relance/types.ts';
import type { ObservateurUsage } from '../budgets/index.ts';
import type {
  ArreteurMission,
  CibleEquipe,
  RelanceurMission,
  RepertoireCibles,
} from '../control-plane/orchestrateur/mcp-controle/types.ts';
import type {
  DescripteurWorkerPc,
  InventairePc,
  ReinitialisateurSession,
  ResultatReinitialisation,
} from '../control-plane/reconciliation/types.ts';
import { GenerateurEntree } from '../control-plane/orchestrateur/entree/index.ts';
import type { StartWorkerDeps, WorkerHandle } from '../workers/index.ts';
import { startWorker as startWorkerReel } from '../workers/index.ts';
import { creerPilotage, type Pilotage } from './pilotage-workers.ts';
import { releverEtatGit, type ConstatGit } from './etat-git.ts';
import { surveillerMessageUsage, surveillerQuota } from './budgets-workers.ts';
import { ConcurrentsRestaures } from './fencing-restauration.ts';
import { missionLogger, superviseurLogger } from './logger.ts';
import type { PersistanceRegistre } from './persistance-registre.ts';
import { RegistreWorkers } from './registre-workers.ts';
import { extraireDemandesEnAttente } from './reponse-reinitialize.ts';
import {
  construireCibleArretUrgence,
  executerArretUrgenceMission,
  executerArretUrgenceParc,
  type DependancesArretUrgence,
} from './arret-urgence-sequence.ts';
import type {
  DemandeDemarrage,
  ObservateurFlux,
  ObservateurRelance,
  RapportArretUrgence,
  ResultatArretUnitaireUrgence,
} from './types.ts';
import {
  GRACE_ARRET_URGENCE_MS_DEFAUT,
  SuperviseurError,
  type DemarrerWorkerFn,
  type DependancesSuperviseur,
} from './superviseur-workers-types.ts';

// Ré-exportés pour ne rien changer à l'API publique (`superviseur/index.ts` les
// importe depuis ce fichier) — extraction structurelle uniquement (dette n°4a).
export { GRACE_ARRET_URGENCE_MS_DEFAUT, SuperviseurError, type DemarrerWorkerFn, type DependancesSuperviseur };

/**
 * Superviseur de workers du PC (B.1.4, D.3.1). Un worker vivant par mission
 * (H-56) ; un enregistrement mort survit pour permettre la relance (B.3.3).
 */
/**
 * `☠` En-deçà de cette marge avant expiration, le jeton est renouvelé en ouvrant
 * une session CLI. Assez large pour qu'un relevé toutes les 5 min ait toujours
 * le temps de le faire avant que le Pi ne se retrouve avec un jeton mort.
 */
const MARGE_RENOUVELLEMENT_JETON_MS = 3_600_000;

export class SuperviseurWorkers implements InventairePc, ReinitialisateurSession, RepertoireCibles, ArreteurMission, RelanceurMission {
  readonly #registre: RegistreWorkers;
  readonly #compteurRelances: CompteurRelances;
  readonly #observateurRelance: ObservateurRelance | undefined;
  readonly #observateurUsage: ObservateurUsage | undefined;
  readonly #observateurFlux: ObservateurFlux | undefined;
  readonly #demarrerWorker: DemarrerWorkerFn;
  readonly #pilotage: Pilotage;
  readonly #startWorkerDeps: StartWorkerDeps;
  /** Ce que seul le PC peut observer, tenu à disposition du Pi (B.1.4). */
  readonly #telemetrie = new CollecteurTelemetrie();
  /** Racine des projets sur le PC — borne l'exploration, jamais dépassée. */
  readonly #racineProjets: string;
  /** Comptes à sonder pour les jauges de rate limit — vide si non configurés. */
  readonly #comptesASonder: readonly { readonly id: string; readonly configDir: string }[];
  readonly #planifier: (delaiMs: number, tache: () => void) => void;
  readonly #attendreGrace: (delaiMs: number) => Promise<void>;
  readonly #persistance: PersistanceRegistre | undefined;
  readonly #terminerConcurrentRestaure: (pid: number, signal: NodeJS.Signals) => void;
  /** Concurrents restaurés depuis la persistance (dette n°1) — voir `fencing-restauration.ts`. */
  readonly #concurrentsRestaures = new ConcurrentsRestaures();
  readonly #antiBoucle: CablageAntiBoucle; // juge anti-boucle H-68 — voir anti-boucle-workers.ts

  constructor(deps: DependancesSuperviseur) {
    this.#compteurRelances = deps.compteurRelances;
    this.#racineProjets = deps.racineProjets ?? '/mnt/projects';
    this.#comptesASonder = deps.comptesASonder ?? [];
    this.#observateurRelance = deps.observateurRelance;
    this.#observateurUsage = deps.observateurUsage;
    this.#observateurFlux = deps.observateurFlux;
    this.#demarrerWorker = deps.demarrerWorker ?? startWorkerReel;
    this.#pilotage = creerPilotage((missionId) => {
      const e = this.#registre.parMission(missionId);
      if (e === null) return null;
      return {
        cible: {
          sessionId: e.sessionId,
          vivant: e.vivant,
          entree: { envoyerMessage: (m) => e.entree.envoyerMessage(m) },
          source: { interrupt: () => e.handle.query.interrupt() },
          capacites: e.handle.capabilities,
        },
        // L'enregistrement lui-même sert de clé : un worker relancé est un
        // nouvel objet, donc un nouvel état de pause — ce qui est correct.
        cle: e,
      };
    });
    this.#startWorkerDeps = deps.startWorkerDeps ?? {};
    this.#planifier = deps.planifier ?? ((delaiMs, tache) => void setTimeout(tache, delaiMs));
    this.#attendreGrace = deps.attendreGrace ?? ((delaiMs) => new Promise((resolve) => setTimeout(resolve, delaiMs)));
    this.#persistance = deps.persistance;
    this.#terminerConcurrentRestaure = deps.terminerConcurrentRestaure ?? ((pid, signal) => void process.kill(pid, signal));
    this.#registre = new RegistreWorkers(deps.persistance ?? null);
    this.#antiBoucle = creerCablageAntiBoucle(deps);
  }

  /**
   * Restaure le registre depuis la persistance disque (dette n°1, TODO.md) — à
   * appeler UNE FOIS au démarrage, avant tout `demarrer()`. No-op sans persistance.
   * Voir `ConcurrentsRestaures.restaurer()` (`fencing-restauration.ts`).
   */
  restaurer(): void {
    if (this.#persistance === undefined) return;
    this.#concurrentsRestaures.restaurer(this.#persistance);
  }

  /**
   * Démarre un worker neuf (D.3.1, opération `demarrer_worker`). Le premier
   * message est mis en file AVANT le spawn (piège H-60 : un flux silencieux
   * n'émet jamais `init`) ; le flux reste ouvert ensuite pour permettre
   * `envoyer_a_equipe`/`interrompre_equipe` (A.2.2) sur ce worker.
   *
   * `☠` Le fencing (D.2.3) est arbitré ICI, EN PREMIER — avant toute création de
   * `GenerateurEntree` ou tout spawn : un candidat rejeté ne doit produire AUCUN
   * effet de bord. Voir `#arbitrerFencingWorktree`.
   */
  async demarrer(demande: DemandeDemarrage): Promise<WorkerHandle> {
    const log = missionLogger(demande.missionId);
    this.#arbitrerFencingWorktree(demande, log);
    this.#assurerWorktree(demande.spec.cwd, log);
    const entree = new GenerateurEntree({ sessionId: demande.spec.sessionId });
    await entree.envoyer(demande.promptInitial);

    const handle = await this.#demarrerWorker(demande.spec, entree.flux, this.#startWorkerDeps);
    this.#telemetrie.ouvrir(demande.missionId, demande.spec.sessionId);
    this.#registre.enregistrer({
      missionId: demande.missionId,
      sessionId: demande.spec.sessionId,
      epoch: demande.epoch,
      worktree: demande.spec.cwd,
      spec: demande.spec,
      handle,
      entree,
      vivant: true,
    });
    log.info({ sessionId: handle.sessionId, epoch: demande.epoch }, 'worker démarré et enregistré (B.1.4)');
    void this.#surveillerResultats(demande.missionId, handle);
    return handle;
  }

  /**
   * Garantit que le worktree existe AVANT le spawn.
   *
   * `☠` Panne mesurée en prod le 2026-08-01, au premier mandat de création de
   * projet. L'orchestrateur avait proposé « créer de zéro le projet lumen » —
   * un mandat parfaitement légitime — et `/mnt/projects/lumen` n'existait pas.
   * `spawn` échoue alors en ENOENT, et le SDK rend un diagnostic ENTIÈREMENT
   * FAUX : « binary exists but failed to launch … musl vs glibc », alors que le
   * binaire est sain et se lance à la main. Deux heures de fausse piste
   * possibles pour un répertoire manquant.
   *
   * `☠` On CRÉE plutôt que de refuser, et seulement SOUS LA RACINE des projets :
   * c'est exactement ce qu'un mandat de création demande, et le confinement
   * empêche qu'un chemin fantaisiste fasse naître un répertoire n'importe où sur
   * le disque. Hors racine, on refuse avec un message qui nomme la cause — pas
   * celui du SDK.
   */
  #assurerWorktree(cwd: string, log: ReturnType<typeof missionLogger>): void {
    if (existsSync(cwd)) return;

    // Hors racine : on ne crée rien — un chemin fantaisiste ne doit pas faire
    // naître un répertoire n'importe où sur le disque. `☠` On ne LÈVE pas non
    // plus : le spawn tranchera. Lever ici rendrait impossible tout worktree
    // fictif, ce dont dépendent les bancs qui n'atteignent jamais le spawn.
    // Ce que ce log garantit, c'est que la VRAIE cause figure au journal juste
    // avant le diagnostic trompeur du SDK — c'est tout ce qu'on lui demande.
    if (!estDansRacine(resolve(this.#racineProjets), resolve(cwd))) {
      log.warn(
        { cwd, racineProjets: this.#racineProjets },
        'worktree inexistant et hors du répertoire de projets — non créé ; si le spawn échoue, ' +
          'la cause est CE chemin, pas la libc du binaire Claude Code',
      );
      return;
    }

    try {
      mkdirSync(cwd, { recursive: true });
      log.info({ cwd }, 'worktree créé pour ce mandat — le projet n’existait pas encore');
    } catch (erreur) {
      // Droits, disque plein, chemin occupé par un fichier : on le dit, et on
      // laisse le spawn échouer avec sa propre erreur plutôt que de masquer.
      log.error({ err: erreur, cwd }, 'création du worktree impossible — le spawn va échouer');
    }
  }

  // -- InventairePc (B.1.4 : « inventaire() fait autorité ») -----------------

  /** Inclut les concurrents restaurés (dette n°1) : les taire mentirait sur ce que « le PC fait autorité » (B.1.4) signifie après un redémarrage. */
  /**
   * Télémétrie de tous les workers connus — lecture pure, jamais mutative (D.3.2).
   * Mesure au passage le contexte des workers VIVANTS : `getContextUsage()` échoue
   * une fois la session close, et un échec ici ne doit jamais priver le Pi du
   * reste du relevé.
   */
  async telemetrie(): Promise<readonly TelemetrieWorker[]> {
    for (const e of this.#registre.tous()) {
      if (!e.vivant) continue;
      try {
        const brut = (await e.handle.query.getContextUsage()) as unknown as {
          totalTokens?: number;
          maxTokens?: number;
          categories?: { name?: string; tokens?: number; isDeferred?: boolean }[];
        };
        if (typeof brut.totalTokens === 'number') {
          // `☠` La ventilation est rendue par le SDK et jetée jusqu'au 23/07 :
          // sans elle, impossible de distinguer un socle incompressible d'un
          // contexte réellement rempli par le travail.
          const ventilation = Array.isArray(brut.categories)
            ? brut.categories
                .filter((c): c is { name: string; tokens: number; isDeferred?: boolean } =>
                  typeof c.name === 'string' && typeof c.tokens === 'number')
                .map((c) => ({ nom: c.name, tokens: c.tokens, differe: c.isDeferred === true }))
            : null;
          this.#telemetrie.poserContexte(e.missionId, brut.totalTokens, brut.maxTokens ?? null, ventilation);
        }
      } catch {
        // Session close ou transport fermé : régime nominal, pas une panne.
      }
      // `☠` Le coût EN COURS DE TOUR. Il ne se lisait que sur un message
      // `result`, qui n'arrive qu'à la FIN d'un tour : une équipe travaillant
      // quinze minutes sur une seule instruction affichait 0,00 $ tout du long,
      // et l'anti-boucle — nourri au même endroit — n'inspectait personne
      // pendant ce temps (mesuré le 01/08). Même chemin que `getContextUsage()`
      // juste au-dessus : une requête de contrôle sur la session vivante, dont
      // on SAIT qu'elle répond en plein tour puisque le contexte, lui, s'affiche.
      try {
        const usage = (await e.handle.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()) as unknown as {
          session?: { total_cost_usd?: number };
        };
        const cout = usage.session?.total_cost_usd;
        if (typeof cout === 'number') this.#telemetrie.poserCout(e.missionId, cout);
      } catch {
        // Idem : après `result` le transport se ferme et l'appel échoue. Le
        // dernier coût connu reste en place — jamais une panne.
      }
      // `☠` Lu sur DISQUE, pas sur le flux : `forwardSubagentText` est non
      // déterministe (H-72.4, 0 à 4 lignes sur 5 sous-agents lancés). Le parc
      // n'affichait donc que « Team leader » sur des équipes qui en avaient cinq.
      // Le disque les rend tous les cinq — vérifié sur les transcripts réels.
      try {
        this.#telemetrie.poserSousAgents(
          e.missionId,
          await lireSousAgents(e.sessionId, e.spec.cwd, e.spec.configDir),
        );
      } catch (erreur) {
        // Un relevé de sous-agents raté ne doit rien coûter au reste de la
        // télémétrie : le dernier connu reste en place.
        superviseurLogger.debug({ err: erreur, missionId: e.missionId }, 'relevé des sous-agents impossible');
      }
    }
    return this.#telemetrie.tous();
  }

  /**
   * Jetons d'accès OAuth des comptes, pour que le Pi sonde les quotas lui-même
   * en HTTP — c'est ce qui garde les jauges vivantes PC ÉTEINT, et ce qui a
   * permis de tomber de 10 min de retard à quelques secondes.
   *
   * `☠` Lecture disque à chaque appel, jamais mise en cache : le CLI réécrit
   * `.credentials.json` quand il renouvelle le jeton, et servir un jeton mémorisé
   * périmé condamnerait la mesure jusqu'au prochain redémarrage du PC.
   */
  async jetons(): Promise<readonly JetonCompte[]> {
    if (this.#comptesASonder.length === 0) return [];
    const jetons = await lireJetonsComptes(this.#comptesASonder);
    const aRenouveler = this.#comptesASonder.filter((c) => {
      const jeton = jetons.find((j) => j.compteId === c.id);
      return jeton === undefined || jeton.expireA - Date.now() < MARGE_RENOUVELLEMENT_JETON_MS;
    });
    if (aRenouveler.length === 0) return jetons;
    // `☠` SEUL usage restant de la sonde SDK, et le seul qu'elle sache faire
    // qu'une requête HTTP ne sait pas : lancer le CLI, qui renouvelle le jeton
    // au passage. Sans ça, un PC allumé 8 h sans lancer une seule mission verrait
    // ses jauges se figer sur un jeton expiré. Au plus une fois par ~8 h.
    superviseurLogger.info(
      { comptes: aRenouveler.map((c) => c.id) },
      'jeton proche de l’expiration — session CLI ouverte pour le renouveler',
    );
    await sonderQuotas(aRenouveler);
    return lireJetonsComptes(this.#comptesASonder);
  }

  /**
   * Arborescence des projets du PC (A.2.2, `lister_projets`/`explorer_projets`).
   *
   * `☠` 7ᵉ occurrence du motif « écrit, testé, branché sur rien » : la fonction
   * `explorerProjets` et la racine `#racineProjets` existaient toutes les deux,
   * mais AUCUNE méthode ne les exposait. `canal-controle.ts` appelle
   * `superviseur.explorerProjets?.()`, obtenait `undefined`, et répondait
   * « exploration non câblée sur ce superviseur » — l'orchestrateur en déduisait
   * qu'il ne pouvait pas vérifier un chemin et partait sur celui qu'on lui
   * donnait, à l'aveugle (constaté en prod le 23/07, au premier vrai dispatch).
   */
  explorerProjets(chemin?: string): ResultatExploration {
    return explorerProjets(this.#racineProjets, chemin);
  }

  /**
   * Avis du juge anti-boucle (H-68) demandé par l'opérateur, sur-le-champ.
   *
   * `☠` Ne coupe jamais et ne consomme aucun palier — voir
   * `CablageAntiBoucle.inspecterMaintenant`. L'ancien bouton « Lancer une
   * inspection » de l'interface tapait dans les données de démonstration et
   * tirait son verdict au hasard : il n'a jamais rien inspecté (constaté le
   * 01/08). C'est le premier chemin réel entre ce bouton et le juge.
   */
  async inspecter(missionId: string): Promise<{ readonly verdict: string; readonly motif: string }> {
    return this.#antiBoucle.inspecterMaintenant(missionId);
  }

  /**
   * Contenu d'un fichier de projet du PC (A.2.2, `lire_fichier`).
   *
   * `☠` Suite directe du défaut ci-dessus : une fois l'arborescence câblée,
   * l'orchestrateur VOYAIT `src-tauri/` sans pouvoir en lire une ligne, et
   * synthétisait quand même « d'après le code ». Même racine, mêmes bornes —
   * `lecture-fichier.ts` réutilise le confinement de `exploration-projets.ts`
   * plutôt que d'en poser un second.
   */
  lireFichier(chemin: string): ResultatLectureFichier {
    return lireFichier(this.#racineProjets, chemin);
  }

  /**
   * Recherche de contenu dans les projets du PC (A.2.2, `rechercher_projets`).
   *
   * `☠` Même racine et même confinement que les deux méthodes ci-dessus. Et
   * surtout : câblée ICI le jour même où l'opération existe. Le motif « écrit,
   * testé, branché sur rien » est documenté deux paragraphes plus haut — le
   * répéter sur la fonction suivante serait impardonnable.
   */
  rechercherProjets(motif: string, chemin?: string, max?: number): Promise<ResultatRecherche> {
    return rechercherDansProjets(this.#racineProjets, motif, chemin, max);
  }

  inventaire(): readonly DescripteurWorkerPc[] {
    const reels = this.#registre.tous().map((e) => ({
      sessionId: e.sessionId,
      worktree: e.worktree,
      epoch: e.epoch,
      vivant: e.vivant,
    }));
    const fantomes = this.#concurrentsRestaures.tous().map((f) => ({
      sessionId: f.sessionId,
      worktree: f.worktree,
      epoch: f.epoch,
      vivant: f.vivant,
    }));
    return [...reels, ...fantomes];
  }

  /**
   * Mort brutale, sans fenêtre de grâce (B.2.2). `☠` Cible l'`AbortController`
   * propre à CE worker — jamais un signal OS par motif générique (incident réel
   * déjà payé sur un hôte partagé). Idempotent par construction : un worker déjà
   * mort ne produit aucun effet supplémentaire.
   */
  tuerSansPreavis(sessionId: string): void {
    const enregistrement = this.#registre.parSession(sessionId);
    if (enregistrement === null || !enregistrement.vivant) return;
    this.#registre.marquerMort(sessionId);
    enregistrement.handle.abortController.abort();
    missionLogger(enregistrement.missionId).warn({ sessionId }, 'worker tué sans préavis (tuerSansPreavis)');
  }

  // -- ReinitialisateurSession (D.2.4, panne #3) -----------------------------

  /**
   * `⚠ HYP à vérifier sur banc réel` — le type public `SDKControlInitializeResponse`
   * (sdk.d.ts) ne déclare PAS de champ `pending_permission_requests`, contrairement
   * au commentaire de `Query.reinitialize()` (« the CLI's response carries any
   * can_use_tool ... requests ... and the SDK redelivers them to canUseTool »). Le
   * champ existe bien sur les types de trame internes (`ControlResponse`,
   * `ControlErrorResponse`) mais pas sur le type de retour exposé. Deux lectures
   * `☠` **HYP TRANCHÉE le 2026-07-22 (H-73)** sur le code du SDK : c'est la lecture
   * (a). Le SDK **consomme** lui-même les demandes en attente pour les **rejouer par
   * `canUseTool`** ; il ne les remonte jamais par la valeur de retour. Donc
   * `demandesEnAttente` est **structurellement toujours vide** et ne doit jamais se
   * lire « aucune demande en attente » : elle ne mesure rien. Ce qui garantit
   * réellement la redélivrance est la présence de `canUseTool` dans les options du
   * worker (H-73.1) — sans lui, la demande rejouée est perdue en silence.
   */
  async reinitialiser(sessionId: string): Promise<ResultatReinitialisation> {
    const enregistrement = this.#registre.parSession(sessionId);
    if (enregistrement === null || !enregistrement.vivant) {
      superviseurLogger.warn({ sessionId }, 'reinitialiser() demandé sur un worker absent ou mort');
      return { demandesEnAttente: [] };
    }
    const brut = await enregistrement.handle.query.reinitialize();
    const demandesEnAttente = extraireDemandesEnAttente(brut);
    if (demandesEnAttente.length > 0) {
      // Contredirait H-73 : le SDK est censé les avoir consommées lui-même.
      superviseurLogger.warn(
        { sessionId, demandesEnAttente: demandesEnAttente.length },
        'reinitialize() a remonté des demandes en attente — contredit H-73, à investiguer',
      );
    }
    missionLogger(enregistrement.missionId).info(
      { sessionId, demandesEnAttente: demandesEnAttente.length },
      'reinitialize() appelé (D.2.4)',
    );
    return { demandesEnAttente };
  }

  /**
   * État du dépôt d'une mission (F, lecture pure). `☠` Sur la MACHINE : le Pi
   * n'a aucun accès à ce disque. Ce constat est ce qui permet de distinguer une
   * équipe qui a livré d'une équipe qui a seulement fini de parler.
   */
  async etatGit(chemin: string): Promise<ConstatGit> {
    return releverEtatGit(chemin);
  }

  // -- RepertoireCibles (A.2.2) ----------------------------------------------

  cible(missionId: string): CibleEquipe | null {
    const enregistrement = this.#registre.parMission(missionId);
    if (enregistrement === null || !enregistrement.vivant) return null;
    const { entree, handle } = enregistrement;
    return {
      envoyerMessage: (message) => entree.envoyerMessage(message),
      interrupt: () => handle.query.interrupt(),
    };
  }

  // -- Pilotage d'une mission vivante (instruction, pause, reprise) -----------

  /**
   * `☠` Premier appelant réel de `ControleurPause` — il existait, testé, branché
   * sur aucun worker. Le pilotage vit dans `pilotage-workers.ts` : ce fichier
   * frôle déjà la limite de 500 lignes.
   */
  get pilotage(): Pilotage {
    return this.#pilotage;
  }

  // -- ArreteurMission (A.2.2, fin de vie) ------------------------------------

  /**
   * Fin de vie volontaire : ferme légitimement le flux d'entrée (A.1.2, jamais
   * la fermeture NON sollicitée que A.1.3 redoute) puis `query.close()` — voie
   * par défaut, avec fenêtre de grâce (contrairement à `tuerSansPreavis`).
   * Idempotent : une mission déjà arrêtée ne produit aucun effet de plus.
   */
  async arreter(missionId: string): Promise<void> {
    const enregistrement = this.#registre.parMission(missionId);
    if (enregistrement === null || !enregistrement.vivant) return;
    this.#registre.marquerMort(enregistrement.sessionId);
    enregistrement.entree.fermer();
    try {
      enregistrement.handle.query.close();
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "query.close() a levé pendant l'arrêt de la mission");
    }
  }

  // -- RelanceurMission (B.3.3, resume) --------------------------------------

  /**
   * Relance après crash ou après décision automatique de `deciderRelance()`
   * (`#surveillerResultats`). `resume`, jamais `forkSession` (B.3.3 : le contexte
   * est préservé, on continue la même session). Idempotent : si le worker visé
   * est déjà vivant (rejeu, ou double appel), aucun second spawn n'a lieu.
   */
  /**
   * `☠` Le verdict « déjà vivant » est RENDU, plus seulement journalisé en
   * `debug`. Une relance sur un worker vivant est un no-op légitime (idempotence
   * après reconnexion), mais l'appelant recevait `void` et annonçait « relance
   * transmise » : l'orchestrateur croyait réveiller une équipe `idle` alors que
   * rien ne se passait, et recommençait (défaut relevé par l'orchestrateur
   * lui-même, 02/08). Pour parler à une équipe vivante : `envoyer_a_equipe`.
   */
  async relancer(missionId: string, sessionId: string): Promise<{ readonly dejaVivant: boolean }> {
    const existant = this.#registre.parSession(sessionId);
    if (existant !== null && existant.vivant) {
      missionLogger(missionId).info({ sessionId }, 'relancer() sans effet : worker déjà vivant (idempotence naturelle)');
      return { dejaVivant: true };
    }
    if (existant === null) {
      throw new SuperviseurError(`aucun WorkerSpec connu pour relancer la session ${sessionId} (jamais démarrée ici)`);
    }
    const entree = new GenerateurEntree({ sessionId });
    const handle = await this.#demarrerWorker(existant.spec, entree.flux, { ...this.#startWorkerDeps, resume: true });
    // `☠` Process neuf : les tâches de fond du précédent sont mortes avec lui.
    // `relancer()` ne repasse pas par `ouvrir()`, donc la remise à zéro se dit
    // ICI — la branche `init` du collecteur ne la fait plus, elle vidait aussi à
    // chaque reprise de tour et ça coûtait des équipes entières.
    this.#telemetrie.reinitialiserTachesFond(missionId);
    this.#registre.remplacer({
      missionId,
      sessionId,
      epoch: existant.epoch,
      worktree: existant.spec.cwd,
      spec: existant.spec,
      handle,
      entree,
      vivant: true,
    });
    missionLogger(missionId).info({ sessionId }, 'worker relancé (resume, B.3.3)');
    void this.#surveillerResultats(missionId, handle);
    return { dejaVivant: false };
  }

  /** Fencing par epoch (D.2.3, panne #2) — implémentation extraite dans `fencing-arbitrage-workers.ts` (dette n°4a). */
  #arbitrerFencingWorktree(demande: DemandeDemarrage, log: ReturnType<typeof missionLogger>): void {
    arbitrerFencingWorktree(
      {
        registre: this.#registre,
        concurrentsRestaures: this.#concurrentsRestaures,
        tuerSansPreavis: (sessionId) => this.tuerSansPreavis(sessionId),
        terminerConcurrentRestaure: this.#terminerConcurrentRestaure,
      },
      demande,
      log,
    );
  }

  /**
   * Unique lecteur du `Query` d'un worker (H « un seul consommateur par Query »).
   * `☠` C'est ICI, et nulle part ailleurs, que `deciderRelance()` est appelé — ce
   * module est le seul à observer un `SDKResultMessage` réel et son
   * `terminal_reason`. Un `result` clôt tout le process (mesuré) : chaque
   * occurrence est traitée puis la boucle s'arrête (`break`) plutôt que de
   * supposer que le flux continuera de lui-même.
   *
   * `rate_limit_event` et les bannières `system`/informational|notification
   * (mission M-51, G.1.4/H-54/H-63) sont observés AVANT le `result` — ils
   * arrivent en cours de tour, jamais après — et ne provoquent PAS de `break` :
   * seul un `result` ferme le flux.
   */
  async #surveillerResultats(missionId: string, handle: WorkerHandle): Promise<void> {
    const log = missionLogger(missionId);
    try {
      for await (const message of handle.query) {
        this.#notifierFlux(missionId, message);
        this.#telemetrie.ingerer(missionId, message);
        this.#antiBoucle.accumuler(missionId, message);
        if (message.type === 'rate_limit_event') {
          this.#surveillerQuota(missionId, handle.sessionId, message.rate_limit_info);
          continue;
        }
        if (message.type === 'system' && (message.subtype === 'informational' || message.subtype === 'notification')) {
          const texte = message.subtype === 'informational' ? message.content : message.text;
          this.#surveillerMessageUsage(missionId, texte);
          continue;
        }
        if (message.type !== 'result') continue;
        // ☠ H-68 : `marquerMort` est retardé jusqu'ici — un `couper` doit trouver le worker
        // encore `vivant` pour que `arreter()` (appelé PAR le câblage anti-boucle) produise un
        // effet réel (`entree.fermer()` + `query.close()`), pas un no-op sur un mort déjà marqué.
        const actionAntiBoucle = await this.#antiBoucle.evaluerEtAppliquer(missionId, message, (id) => this.arreter(id));

        // ☠☠ UN `result` EST LA FIN D'UN TOUR, PAS LA FIN DE LA SESSION.
        //
        // Ce module marquait le worker MORT et sortait de la boucle au PREMIER
        // `result`. En streaming input, la session survit pourtant à ses tours :
        // mesuré sur banc réel (23/07) — après `result n°1`, le SDK a émis
        // `background_tasks_changed`, `task_notification`, un nouvel `init`, puis
        // le lead a REPRIS TOUT SEUL avec le résultat de son sous-agent, jusqu'à
        // un `result n°2`. Le flux, lui, ne s'est jamais terminé.
        //
        // Conséquence du défaut, mesurée en production le même jour : une équipe
        // dont le lead déléguait à quatre sous-agents était déclarée « terminée »
        // à la seconde où il rendait la main ; les quatre transcripts se sont
        // arrêtés net, deux d'entre eux après cinq lignes. Le travail était perdu
        // et l'opérateur lisait « terminée ».
        //
        // On ne raccroche donc plus sur un `result` tant qu'une tâche de fond
        // vit. La mort n'est plus DÉDUITE : elle est CONSTATÉE à la fin réelle du
        // flux (après la boucle) ou décidée par un arrêt explicite.
        if (this.#telemetrie.aDesTachesFond(missionId) && actionAntiBoucle !== 'couper') {
          log.info(
            { taches: true },
            'tour terminé mais des tâches de fond vivent — la session reste ouverte, écoute poursuivie',
          );
          continue;
        }

        // ☠☠ UN TOUR QUI FINIT N'EST PAS UNE ÉQUIPE QUI MEURT.
        //
        // Le critère « des tâches de fond tournent » (ci-dessus) est nécessaire
        // mais PAS suffisant, mesuré en prod le 23/07 : un lead qui reçoit le
        // premier lot, annonce « j'attends les cinq autres » et rend la main le
        // fait à un instant où PLUS AUCUNE tâche ne tourne — il croit attendre.
        // Trois runs sur quatre sont morts exactement là.
        //
        // La session, elle, est bel et bien vivante : on peut lui parler. La
        // tuer était donc un choix, pas une fatalité — et c'est ce choix qui
        // faisait perdre le travail. Le worker reste VIVANT, au repos (`idle`) :
        // l'orchestrateur peut le relancer d'un message, l'opérateur peut lui
        // écrire, et `arreter_equipe` reste le seul geste qui termine une équipe.
        //
        // C'est aussi ce qui répare `envoyer_a_equipe`, qui repartait en
        // « processus mort » dès le premier tour (défaut noté dans STATE.md).
        //
        // La mort reste CONSTATÉE, jamais déduite : fin réelle du flux, arrêt
        // explicite, ou coupure du juge anti-boucle.
        const decision = deciderRelance(handle.sessionId, message.terminal_reason, {
          compteur: this.#compteurRelances,
        });

        // `☠ SUR-CORRECTION RETIRÉE (23/07)` — j'ai un temps gardé la session
        // ouverte sur TOUTE fin normale, en croyant qu'un lead pouvait « croire
        // attendre » sans tâche de fond. La mesure a tranché contre moi : sur la
        // mission a122e20c, la garde ci-dessus a bel et bien retenu la session à
        // 18:40:13 pendant que le sous-agent travaillait, le lead a repris seul
        // et rendu sa synthèse à 18:43:35. La garde SUFFIT. Ne rien terminer
        // ensuite laissait une équipe « en cours » à vie, travail rendu.
        //
        // Donc : plus aucune tâche de fond + fin normale = la mission est FINIE.
        if (actionAntiBoucle !== 'couper') this.#registre.marquerMort(handle.sessionId);
        this.#telemetrie.fermer(missionId);
        log.info({ action: decision.action, motif: decision.motif }, 'terminaison observée, politique de relance appliquée');
        this.#notifierDecision(missionId, decision);
        // ☠ H-68 : `couper`/`escalader` priment sur `deciderRelance`, jamais l'inverse (log déjà émis par `#antiBoucle`).
        if (decision.action === 'relancer' && actionAntiBoucle !== 'couper' && actionAntiBoucle !== 'escalader') {
          this.#planifier(decision.delaiMs, () => {
            this.relancer(missionId, handle.sessionId).catch((erreur: unknown) => {
              log.error({ err: erreur }, 'relance automatique en échec');
            });
          });
        }
        break;
      }
      // ☠ Sortie NATURELLE du flux : la session est réellement close (le SDK a
      // fermé le transport, ou `arreter()` a fermé l'entrée). C'est le seul
      // constat de mort qui ne soit pas une déduction.
      this.#marquerMortSiToujoursLeNotre(missionId, handle);
    } catch (erreur) {
      log.error({ err: erreur }, 'boucle de surveillance des résultats interrompue par une exception');
      // Une exception laisse un worker qu'on ne lit plus : le taire le ferait
      // passer pour vivant à jamais, et l'opérateur piloterait un fantôme.
      this.#marquerMortSiToujoursLeNotre(missionId, handle);
    }
  }

  /**
   * Constate la mort du worker qu'on surveillait — et de LUI SEUL.
   *
   * `☠` Une relance réutilise le MÊME `sessionId` (`resume`, B.3.3) : marquer
   * mort par identifiant après la boucle tuait le worker RELANCÉ, celui qui vient
   * tout juste de prendre la place. La comparaison porte donc sur la poignée
   * elle-même, seule identité qui distingue deux générations d'un même id.
   */
  #marquerMortSiToujoursLeNotre(missionId: string, handle: WorkerHandle): void {
    const courant = this.#registre.parSession(handle.sessionId);
    if (courant !== null && courant.handle !== handle) return;
    this.#registre.marquerMort(handle.sessionId);
    this.#telemetrie.fermer(missionId);
  }

  /**
   * Best-effort (H-15) : notifie un observateur déjà en mémoire, n'ouvre AUCUNE
   * connexion. La remontée réelle vers le Pi passe par le canal d'observation
   * (E.2, hors périmètre) — c'est l'exception documentée de D.3.2 au « le PC
   * n'initie jamais » : ce module lui-même n'initie rien, il se contente
   * d'appeler un callback fourni par l'appelant.
   */
  #notifierDecision(missionId: string, decision: DecisionRelance): void {
    try {
      this.#observateurRelance?.surDecision(missionId, decision);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "l'observateur de relance a levé — ignoré, jamais bloquant");
    }
  }

  /**
   * Relaie CHAQUE message vu par l'unique consommateur au client
   * d'observabilité (E.2, mission M-50) — avant toute autre interprétation,
   * jamais entrelacé avec un appel de contrôle (piège mesuré H-72.3).
   * Best-effort, jamais bloquant, jamais interrompt la boucle de surveillance.
   */
  #notifierFlux(missionId: string, message: Parameters<ObservateurFlux['ingererMessageFlux']>[1]): void {
    try {
      this.#observateurFlux?.ingererMessageFlux(missionId, message);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "l'observateur de flux a levé — ignoré, jamais bloquant");
    }
  }

  /** Relaie un `rate_limit_event` brut (H-54/H-63, mission M-51). Voir `budgets-workers.ts` (dette n°4a). */
  #surveillerQuota(missionId: string, sessionId: string, info: Parameters<typeof surveillerQuota>[3]): void {
    surveillerQuota(this.#observateurUsage, missionId, sessionId, info);
  }

  /** Classifie une bannière `system` d'usage (G.1.4, mission M-51). Voir `budgets-workers.ts` (dette n°4a). */
  #surveillerMessageUsage(missionId: string, texte: string): void {
    surveillerMessageUsage(this.#observateurUsage, missionId, texte);
  }

  // -- Arrêt d'urgence (G.4, mission M-52) -----------------------------------
  // ☠ (a) Jamais via l'orchestrateur : accessible uniquement via `CanalControle`
  // (D.3), frontière A↔B inexistante (03-couche-1.md). ☠ (b) Aucun worktree
  // détruit : ni ce fichier ni `arret-urgence-sequence.ts` n'importent
  // `projets/cycle-vie-worktree.ts`. Séquence (pause → fermeture → grâce →
  // forçage, c) dans `arret-urgence-sequence.ts` (limite 500 lignes).

  /**
   * Filet de dernier recours (c) — DIFFÉRENT de `tuerSansPreavis()` : celui-ci
   * refuse d'agir dès que `vivant === false` (B.2.2, usage routinier, où un
   * enregistrement mort n'a jamais besoin d'être re-tué). Or `arreter()`
   * marque `vivant = false` de façon OPTIMISTE, avant même que `query.close()`
   * ait fini son cycle de grâce interne (~2 s, 01-verification-sdk.md) — un
   * filet qui se fierait au même drapeau ne se déclencherait donc JAMAIS après
   * une fermeture propre déjà tentée. `AbortController.abort()` est nativement
   * idempotent : c'est ce qui rend sûr d'appeler cette méthode SANS condition
   * sur `vivant`, y compris quand la fermeture propre a déjà réussi.
   */
  forcerArretUrgence(sessionId: string): void {
    const enregistrement = this.#registre.parSession(sessionId);
    if (enregistrement === null) return;
    this.#registre.marquerMort(sessionId);
    enregistrement.handle.abortController.abort();
    missionLogger(enregistrement.missionId).warn(
      { sessionId },
      "arrêt d'urgence : forçage appliqué (filet de dernier recours, idempotent, G.4)",
    );
  }

  /**
   * Arrêt d'urgence ciblé sur UNE mission (G.4). Utilisé par le déclenchement
   * global (`arretUrgence()`) et par le banc de drill récurrent (G.4.3,
   * `arret-urgence/exercice-periodique.ts`) — c'est la même vraie séquence de
   * production qui est exercée à froid, pas une simulation.
   */
  async arreterMissionEnUrgence(
    missionId: string,
    graceMs: number = GRACE_ARRET_URGENCE_MS_DEFAUT,
  ): Promise<ResultatArretUnitaireUrgence | null> {
    const enregistrement = this.#registre.parMission(missionId);
    if (enregistrement === null || !enregistrement.vivant) return null;
    return executerArretUrgenceMission(construireCibleArretUrgence(enregistrement), this.#depsArretUrgence(graceMs));
  }

  /**
   * Point d'entrée du bouton d'arrêt d'urgence (G.4.1/G.4.2) : arrête TOUTES
   * les missions vivantes du PC, en parallèle (isolation). Idempotent : un
   * second appel ne trouve que ce qui reste vivant (snapshot à l'instant de
   * l'appel) et ne relève jamais d'exception sur ce qui est déjà à l'arrêt.
   */
  async arretUrgence(graceMs: number = GRACE_ARRET_URGENCE_MS_DEFAUT): Promise<RapportArretUrgence> {
    const cibles = this.#registre.tous().filter((e) => e.vivant).map(construireCibleArretUrgence);
    return executerArretUrgenceParc(cibles, this.#depsArretUrgence(graceMs));
  }

  #depsArretUrgence(graceMs: number): DependancesArretUrgence {
    return {
      fermerProprement: (missionId: string) => this.arreter(missionId),
      forcer: (sessionId: string) => this.forcerArretUrgence(sessionId),
      attendreGrace: this.#attendreGrace,
      graceMs,
    };
  }
}
