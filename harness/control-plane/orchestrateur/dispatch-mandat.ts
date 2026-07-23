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
 * Crée la mission puis démarre l'équipe. Lève si le compte ou le PC manquent —
 * l'appelant traduit en erreur visible : un mandat autorisé dont rien ne part
 * doit se voir, jamais se perdre.
 */
export async function dispatcherMandat(p: Proposition, deps: DependancesDispatch): Promise<ResultatDispatch> {
  const compte = deps.registre.comptes.listerDisponibles()[0];
  if (compte === undefined) {
    throw new Error('aucun compte Claude disponible — tous saturés ou aucun enregistré');
  }

  const missionId = randomUUID();
  const sessionId = randomUUID();
  const lotId = randomUUID();
  const cwd = join(deps.repertoireProjets, p.projet);

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
  });

  const demande: DemandeDemarrageTransportable = {
    missionId,
    epoch: 1,
    promptInitial: composerPromptInitial(p),
    parametres: {
      sessionId,
      cwd,
      mandate: p.objectif,
      deniedToolPatterns: [...(deps.deniedToolPatterns ?? [])],
      maxBudgetUsd: p.budgetMaxUsd > 0 ? p.budgetMaxUsd : BUDGET_DEFAUT_USD,
      configDir: compte.configDir,
    },
  };

  const { detail } = await deps.demarreur.demarrer(demande);
  log.info({ missionId, projet: p.projet, compteId: compte.id }, 'équipe démarrée après autorisation humaine (H-61)');
  return { missionId, detail };
}
