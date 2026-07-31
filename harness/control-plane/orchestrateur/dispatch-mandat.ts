/**
 * Responsabilité : ce qui se passe quand l'opérateur AUTORISE un mandat (H-61).
 * C'est le seul endroit du harness où une équipe est réellement créée.
 *
 * `☠` H-61 est la règle la plus stricte du produit : l'orchestrateur propose,
 * l'humain seul dispose. Ce module n'est donc jamais appelé par une session
 * orchestrateur — uniquement par la route d'écriture déclenchée par un clic.
 *
 * `☠` L'ordre des opérations n'est pas cosmétique. La mission est inscrite au
 * registre AVANT le démarrage : si le PC répond mal (ou pas), on a une trace
 * d'une mission `planifiee` que la réconciliation pourra rattraper. L'inverse —
 * démarrer puis inscrire — laisserait un worker vivant que le Pi ne connaîtrait
 * pas, c'est-à-dire exactement une équipe fantôme (panne #11).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Proposition, Registre } from '../registre/index.ts';
import type { DemandeDemarrageTransportable } from '../../superviseur/index.ts';
import { effortsDe, messageModeleInconnu, normaliserModele } from '../../shared/modeles-claude.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'dispatch-mandat' });

/** Ce que le Pi sait faire démarrer sur le PC. */
export interface DemarreurEquipe {
  demarrer(demande: DemandeDemarrageTransportable): Promise<{ readonly detail: string }>;
}

export interface DependancesDispatch {
  readonly registre: Registre;
  readonly demarreur: DemarreurEquipe;
  /** Racine des projets sur le PC — le worktree en dérive. */
  readonly repertoireProjets: string;
  /** Motifs d'outils refusés d'office (plancher de déni, H-41). */
  readonly deniedToolPatterns?: readonly string[];
}

export interface ResultatDispatch {
  readonly missionId: string;
  readonly detail: string;
}

/** Budget par défaut d'une équipe, quand le mandat n'en fixe pas. */
const BUDGET_DEFAUT_USD = 12;

/**
 * `☠` Défauts du team leader, POSÉS et non hérités du CLI (décision Chris,
 * 2026-07-23). Un lead est le cerveau d'une équipe : le laisser tomber sur le
 * modèle ou l'effort par défaut de la machine le ferait échouer lentement, sans
 * qu'aucun signal ne le dise. L'orchestrateur peut les remplacer si l'opérateur
 * le lui demande (« sonnet 5 medium »), jamais de sa propre initiative.
 */
// `☠` Suivait `claude-opus-4-8`, qui a DISPARU de `supportedModels()` au passage
// au SDK 0.3.220 (CLI 2.1.220) : tout dispatch serait parti sur un modèle que le
// CLI n'expose plus. Mesuré le 31/07, pas supposé.
export const MODELE_LEAD_DEFAUT = 'claude-opus-5';
export const EFFORT_LEAD_DEFAUT = 'high';

/**
 * `☠` Un effort invalide est SILENCIEUSEMENT ignoré par le SDK (mesuré le
 * 2026-07-22 : `effort: 'ultra'` passe sans erreur et retombe au défaut). On le
 * refuse ici plutôt que de croire l'avoir appliqué.
 *
 * `☠` Les niveaux acceptés DÉPENDENT DU MODÈLE — la liste vivait en dur ici et
 * ignorait `max`, qui retombait donc en silence sur `high` alors qu'il est
 * valide partout sauf sur Haiku. Source unique : `shared/modeles-claude.ts`.
 */
type EffortWorker = 'low' | 'medium' | 'high' | 'xhigh';

function effortValide(brut: string | null, modele: string): EffortWorker {
  // `☠` `max` est retiré des choix POUR UN WORKER : il n'existe que via
  // `applyFlagSettings` (portée session), et un worker reçoit son effort par la
  // cascade de settings persistés, qui l'exclut. L'accepter ici donnerait un
  // réglage qu'on croit posé et qui ne l'est pas — voir `superviseur/types.ts`.
  const acceptes = effortsDe(modele).filter((e): e is EffortWorker => e !== 'max');
  // Haiku n'accepte AUCUN effort ; rien à valider, le défaut passe tel quel.
  if (acceptes.length === 0) return EFFORT_LEAD_DEFAUT as EffortWorker;
  const e = (brut ?? EFFORT_LEAD_DEFAUT).toLowerCase() as EffortWorker;
  if (!acceptes.includes(e)) {
    log.warn(
      { effort: brut, modele, acceptes },
      'niveau de raisonnement indisponible pour ce modèle sur un worker — repli sur le défaut',
    );
    return EFFORT_LEAD_DEFAUT as EffortWorker;
  }
  return e;
}

/**
 * Le modèle demandé n'est pas reconnaissable. `☠` Erreur NOMMÉE, levée AVANT
 * toute écriture : l'orchestrateur est un modèle, il se corrige tout seul si on
 * lui rend la liste des valeurs acceptées. Une équipe morte deux secondes après
 * son démarrage ne lui apprend rien (vécu le 31/07 avec « sonnet 5 »).
 */
export class ErreurModeleInconnu extends Error {
  constructor(readonly demande: string) {
    super(messageModeleInconnu(demande));
    this.name = 'ErreurModeleInconnu';
  }
}

/**
 * Compose le premier message du lead. `☠` Jamais vide : un flux d'entrée
 * silencieux n'émet jamais `init`, et le worker resterait muet (piège H-60).
 */
export function composerPromptInitial(p: Proposition): string {
  const critere = p.critereArret ?? 'non fixé — rends la main dès que l’objectif est atteint';
  return [
    `Mandat autorisé par l'opérateur.`,
    ``,
    `Projet : ${p.projet}`,
    `Objectif : ${p.objectif}`,
    `Critère d'arrêt : ${critere}`,
    `Périmètre : ${p.perimetre}`,
    ``,
    `Commence par établir l'état des lieux avant de modifier quoi que ce soit.`,
  ].join('\n');
}

/**
 * `☠` L'epoch DOIT croître à chaque dispatch sur un même worktree : le fencing
 * (M-11) rejette explicitement une égalité, précisément pour empêcher deux
 * workers de coexister sur le même répertoire. Un `epoch: 1` codé en dur rendait
 * donc tout second dispatch impossible sur un projet déjà utilisé (constaté en
 * prod le 23/07 : `collision_meme_epoch`).
 */
function prochainEpoch(registre: Registre, projet: string): number {
  const epochs = registre.missions
    .listerRecentes()
    .filter((m) => m.projet === projet)
    .map((m) => m.epoch);
  return epochs.length === 0 ? 1 : Math.max(...epochs) + 1;
}

/**
 * Crée la mission puis démarre l'équipe. Lève si le compte ou le PC manquent —
 * l'appelant traduit en erreur visible : un mandat autorisé dont rien ne part
 * doit se voir, jamais se perdre.
 */
/**
 * Une équipe est déjà active sur ce projet (H-56 : une seule à la fois). Erreur
 * NOMMÉE, pas générique : l'appelant doit pouvoir en faire un refus lisible
 * plutôt qu'un 500 anonyme.
 */
export class ErreurProjetOccupe extends Error {
  constructor(
    readonly missionId: string,
    readonly projet: string,
    readonly etat: string,
  ) {
    super(
      `une équipe est déjà active sur « ${projet} » (mission ${missionId.slice(0, 8)}, état ${etat}) — ` +
        'termine-la avec `arreter_equipe` avant d’en lancer une autre (H-56 : une équipe par projet)',
    );
    this.name = 'ErreurProjetOccupe';
  }
}

export async function dispatcherMandat(p: Proposition, deps: DependancesDispatch): Promise<ResultatDispatch> {
  // `☠` Rotation (H-53) : `listerDisponibles()` exclut les comptes marqués
  // `rejected` par le balayage de télémétrie. C'est ici que la bascule se fait —
  // silencieusement pour l'opérateur, mais tracée.
  const disponibles = deps.registre.comptes.listerDisponibles();
  const compte = disponibles[0];
  if (compte === undefined) {
    const tous = deps.registre.comptes.lister().length;
    throw new Error(
      tous === 0
        ? 'aucun compte Claude enregistré — impossible de démarrer une équipe'
        : `les ${tous} comptes connus sont saturés — attends une remise à zéro de fenêtre avant de relancer`,
    );
  }
  if (deps.registre.comptes.lister()[0]?.id !== compte.id) {
    log.info({ compteId: compte.id }, 'rotation de compte : le précédent est saturé');
  }

  // `☠` H-56 VÉRIFIÉ ICI, avant toute écriture. L'index unique partiel de la base
  // fait bien son travail, mais son échec remontait en `SQLITE_CONSTRAINT_UNIQUE`
  // ⇒ 500 ⇒ « erreur interne du control plane » à l'écran (constaté en prod le
  // 23/07). Une règle métier connue n'est PAS une panne : elle se refuse en
  // clair, en nommant l'équipe qui bloque, sinon l'opérateur clique trois fois
  // sans jamais comprendre pourquoi rien ne part.
  const dejaActive = deps.registre.missions.listerActives().find((m) => m.projet === p.projet);
  if (dejaActive !== undefined) {
    throw new ErreurProjetOccupe(dejaActive.id, p.projet, dejaActive.etatHarness);
  }

  const missionId = randomUUID();
  const sessionId = randomUUID();
  const lotId = randomUUID();
  // `☠` VALIDÉ ICI, avant la moindre écriture : la valeur vient d'un LLM qui
  // écrit en langage naturel. « sonnet 5 » partait tel quel au CLI et tuait
  // l'équipe deux secondes après son démarrage (31/07).
  const modele = p.modele === null || p.modele === undefined ? MODELE_LEAD_DEFAUT : normaliserModele(p.modele);
  if (modele === null) throw new ErreurModeleInconnu(p.modele ?? '');
  const effort = effortValide(p.effort, modele);
  // `☠` Le worktree vit sur le PC, pas sur le Pi. Un projet déjà donné en chemin
  // absolu est pris tel quel : le concaténer au répertoire de projets du Pi
  // produisait `/home/pi/projets/mnt/projects/vela` — un chemin qui n'existe sur
  // aucune des deux machines (constaté en prod le 23/07).
  const cwd = p.projet.startsWith('/') ? p.projet : join(deps.repertoireProjets, p.projet);

  deps.registre.lots.creer({ id: lotId, intention: p.objectif, origine: 'orchestrateur' });
  deps.registre.missions.creer({
    id: missionId,
    lotId,
    nom: p.objectif.slice(0, 80),
    projet: p.projet,
    compteId: compte.id,
    sessionId,
    mandat: p.objectif,
    critereArret: p.critereArret,
    budgetMaxUsd: p.budgetMaxUsd,
    worktree: cwd,
    // `☠` Le modèle est CONNU ici : c'est le harness qui l'impose, pas le CLI qui
    // le choisit. L'écrire évite un « (non résolu) » à l'écran alors que la
    // valeur ne fait aucun doute. Ce qui reste réellement inconnu du Pi tant que
    // la télémétrie n'existe pas : coût, contexte, état SDK.
    modeleDemande: modele,
    modeleResolu: modele,
  });

  const demande: DemandeDemarrageTransportable = {
    missionId,
    epoch: prochainEpoch(deps.registre, p.projet),
    promptInitial: composerPromptInitial(p),
    parametres: {
      sessionId,
      cwd,
      mandate: p.objectif,
      deniedToolPatterns: [...(deps.deniedToolPatterns ?? [])],
      maxBudgetUsd: p.budgetMaxUsd > 0 ? p.budgetMaxUsd : BUDGET_DEFAUT_USD,
      model: modele,
      effortLevel: effort,
      configDir: compte.configDir,
    },
  };

  const { detail } = await deps.demarreur.demarrer(demande);
  // `☠` L'état n'est avancé qu'APRÈS un démarrage confirmé : une mission laissée
  // `planifiee` alors que le worker tourne serait une équipe fantôme, et
  // l'inverse ferait croire à une équipe vivante qui n'existe pas.
  deps.registre.etats.appliquerEtatHarness(missionId, 'en_cours', { motif: 'mandat autorisé par l’opérateur' });
  log.info({ missionId, projet: p.projet, compteId: compte.id }, 'équipe démarrée après autorisation humaine (H-61)');
  return { missionId, detail };
}
