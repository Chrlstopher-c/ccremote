/**
 * Responsabilité : valider une configuration de projet brute (F.1.2, F.4.2).
 *
 * `☠ CASSE` évité ici — un projet invalide doit être **écarté**, jamais chargé
 * partiellement (F.4.2) : la seule façon de construire un `ConfigProjet` est
 * `validerConfigProjet`, et elle ne le rend qu'après que **tous** les contrôles
 * ont réussi. Aucune valeur partielle n'est jamais retournée en cas d'échec.
 *
 * Réutilise, plutôt que dupliquer (DRY métier) :
 * - `resolveModel` / `assertModelFloor` de `workers/index.ts` (H-43, plancher Sonnet) ;
 * - `assertMotifsScopes` / `assertIdsUniques` de `plancher-deni/index.ts` (panne #21).
 */

import { stat } from 'node:fs/promises';
import {
  ModelFloorError,
  ModelResolutionError,
  assertModelFloor,
  resolveModel,
} from '../workers/index.ts';
import {
  MAX_MOTIFS_PLANCHER,
  MotifNonScopeError,
  assertIdsUniques,
  assertMotifsScopes,
  formatterRegleSdk,
} from '../plancher-deni/index.ts';
import type { MotifDeni, OutilCible } from '../plancher-deni/index.ts';
import { projetsLogger } from './logger.ts';
import type { InterrogateurGit } from './git-projet.ts';
import type { ConfigProjet, ConfigProjetBrute, EchecValidationProjet } from './types.ts';

/**
 * Seuil d'**alerte**, jamais de rejet (arbitrage rendu le 2026-07-22, dette n°4).
 *
 * La valeur précédente — 8, rejetante — était un chiffre inventé, et surtout à
 * l'envers : les motifs supplémentaires d'un projet **renforcent** le plancher de
 * déni. Rejeter au-delà d'un seuil, c'est faire échouer le chargement d'un projet
 * parce qu'il est **trop prudent**. Le rejet reste réservé aux configurations qui
 * affaiblissent le plancher ou qui se contredisent (motif non scopé, projet
 * non-git déclarant une branche), jamais à celles qui sur-restreignent.
 *
 * Le seuil est aligné sur `MAX_MOTIFS_PLANCHER` plutôt que fixé arbitrairement :
 * un projet qui ajoute à lui seul plus de motifs que le plancher global entier
 * signale une configuration aberrante — ce qui mérite d'être **dit**, pas bloqué.
 */
export const SEUIL_ALERTE_MOTIFS_SUPPLEMENTAIRES_PROJET = MAX_MOTIFS_PLANCHER;

const RE_ID_PROJET = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OUTILS_CIBLES: readonly OutilCible[] = ['Bash', 'Write', 'Edit'];

export interface DependancesValidation {
  readonly interrogateurGit: InterrogateurGit;
}

export interface ResultatValidationProjet {
  readonly config: ConfigProjet | null;
  readonly echecs: readonly EchecValidationProjet[];
}

function echec(code: EchecValidationProjet['code'], detail: string): EchecValidationProjet {
  return { code, detail };
}

function validerId(brute: ConfigProjetBrute): { id: string | null; echecs: EchecValidationProjet[] } {
  if (typeof brute.id !== 'string' || !RE_ID_PROJET.test(brute.id)) {
    return {
      id: null,
      echecs: [echec('id_manquant_ou_invalide', `"id" doit être une chaîne kebab-case non vide (reçu : ${JSON.stringify(brute.id)}).`)],
    };
  }
  return { id: brute.id, echecs: [] };
}

async function validerChemin(chemin: unknown): Promise<{ chemin: string | null; echecs: EchecValidationProjet[] }> {
  if (typeof chemin !== 'string' || chemin.trim().length === 0) {
    return { chemin: null, echecs: [echec('chemin_depot_manquant', '"cheminDepot" est requis et doit être une chaîne non vide.')] };
  }
  try {
    const info = await stat(chemin);
    if (!info.isDirectory()) {
      return { chemin: null, echecs: [echec('chemin_depot_pas_un_repertoire', `${chemin} existe mais n'est pas un répertoire.`)] };
    }
    return { chemin, echecs: [] };
  } catch (error) {
    return { chemin: null, echecs: [echec('chemin_depot_introuvable', `${chemin} introuvable ou illisible (${String(error)}).`)] };
  }
}

async function validerBranche(
  brute: ConfigProjetBrute,
  chemin: string,
  git: InterrogateurGit,
): Promise<{ estGit: boolean; branche: string | null; echecs: EchecValidationProjet[] }> {
  const estGit = await git.estDepotGit(chemin);
  const brancheBrute = brute.brancheDefaut;

  if (!estGit) {
    if (typeof brancheBrute === 'string' && brancheBrute.trim().length > 0) {
      return {
        estGit,
        branche: null,
        echecs: [echec('branche_defaut_sur_projet_non_git', `"brancheDefaut" ne peut pas être fixée : ${chemin} n'est pas un dépôt git (F.1.3).`)],
      };
    }
    return { estGit, branche: null, echecs: [] };
  }

  if (typeof brancheBrute !== 'string' || brancheBrute.trim().length === 0) {
    return {
      estGit,
      branche: null,
      echecs: [echec('branche_defaut_manquante_pour_depot_git', '"brancheDefaut" est requise pour un projet git.')],
    };
  }

  const existe = await git.existeBranche(chemin, brancheBrute);
  if (!existe) {
    return {
      estGit,
      branche: null,
      echecs: [echec('branche_defaut_introuvable', `la branche "${brancheBrute}" n'existe pas dans ${chemin}.`)],
    };
  }
  return { estGit, branche: brancheBrute, echecs: [] };
}

function validerBudget(brute: ConfigProjetBrute): { budget: number | null; echecs: EchecValidationProjet[] } {
  const budget = brute.budgetMaxUsd;
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
    return {
      budget: null,
      echecs: [echec('budget_invalide', `"budgetMaxUsd" doit être un nombre fini strictement positif (reçu : ${JSON.stringify(budget)}).`)],
    };
  }
  return { budget, echecs: [] };
}

/** Réutilise le plancher Sonnet (H-43) sans le dupliquer — voir en-tête. */
function validerModele(brute: ConfigProjetBrute): { modele: string | null; echecs: EchecValidationProjet[] } {
  const modele = brute.modeleDefaut;
  if (typeof modele !== 'string' || modele.trim().length === 0) {
    return { modele: null, echecs: [echec('modele_defaut_invalide', '"modeleDefaut" est requis et doit être une chaîne non vide.')] };
  }
  try {
    // Pas de cascade de settings à ce stade (validation hors session) : `inherit`
    // ne peut donc jamais se résoudre ici, et c'est volontaire (panne #20 : ne pas
    // valider sur l'alias, mais un alias qui délègue n'a justement rien à valider).
    const resolved = resolveModel(modele, null);
    assertModelFloor(resolved);
    return { modele, echecs: [] };
  } catch (error) {
    if (error instanceof ModelResolutionError || error instanceof ModelFloorError) {
      return { modele: null, echecs: [echec('modele_defaut_invalide', error.message)] };
    }
    throw error;
  }
}

function estFormeMoti(valeur: unknown): valeur is MotifDeni {
  if (typeof valeur !== 'object' || valeur === null) return false;
  // Narrowing manuel : `typeof === 'object' && !== null` ne suffit pas à TS pour
  // autoriser l'indexation par chaîne — la forme exacte est justement ce que
  // cette fonction est chargée de prouver, champ par champ, plus bas.
  const candidat = valeur as Record<string, unknown>;
  return (
    typeof candidat['id'] === 'string' &&
    typeof candidat['outil'] === 'string' &&
    // Cast vers l'union `OutilCible` pour satisfaire `.includes` : la ligne
    // précédente a déjà prouvé que c'est une chaîne, `.includes` prouve que
    // c'est la bonne.
    OUTILS_CIBLES.includes(candidat['outil'] as OutilCible) &&
    typeof candidat['contenuRegle'] === 'string' &&
    typeof candidat['porte'] === 'string' &&
    typeof candidat['nonQuotidien'] === 'string'
  );
}

type ResultatMotifs = { motifs: readonly MotifDeni[]; echecs: EchecValidationProjet[] };

/** Vérifie la forme brute : tableau de motifs bien typés, sous le plafond local. */
function verifierFormeMotifs(valeur: unknown): ResultatMotifs | null {
  if (!Array.isArray(valeur)) {
    return { motifs: [], echecs: [echec('motif_deni_supplementaire_invalide', '"deniedToolPatternsSupplementaires" doit être un tableau.')] };
  }
  if (!valeur.every(estFormeMoti)) {
    return {
      motifs: [],
      echecs: [
        echec(
          'motif_deni_supplementaire_invalide',
          'chaque motif requiert : id, outil (Bash|Write|Edit), contenuRegle, porte, nonQuotidien — tous en chaîne.',
        ),
      ],
    };
  }
  if (valeur.length > SEUIL_ALERTE_MOTIFS_SUPPLEMENTAIRES_PROJET) {
    // Alerte, jamais rejet : une config plus restrictive n'est pas une config invalide.
    projetsLogger.warn(
      { motifs: valeur.length, seuil: SEUIL_ALERTE_MOTIFS_SUPPLEMENTAIRES_PROJET },
      'projet déclarant plus de motifs de déni que le plancher global entier — configuration probablement aberrante',
    );
  }
  return null;
}

/** Applique les garde-fous partagés du plancher (panne #21) — jamais dupliqués. */
function appliquerGardesFouPlancher(motifs: readonly MotifDeni[]): ResultatMotifs {
  try {
    assertMotifsScopes(motifs);
    assertIdsUniques(motifs);
    // Format rejoué explicitement pour prouver que chaque motif produit une règle
    // SDK non vide — un motif « scopé » mais mal formé resterait sinon silencieux.
    for (const motif of motifs) void formatterRegleSdk(motif);
    return { motifs, echecs: [] };
  } catch (error) {
    if (error instanceof MotifNonScopeError) {
      return { motifs: [], echecs: [echec('motif_deni_supplementaire_non_scope', error.message)] };
    }
    return { motifs: [], echecs: [echec('motif_deni_supplementaire_id_duplique', String(error))] };
  }
}

/** Réutilise `assertMotifsScopes` / `assertIdsUniques` (panne #21) sans les dupliquer. */
function validerMotifsSupplementaires(brute: ConfigProjetBrute): ResultatMotifs {
  const valeur = brute.deniedToolPatternsSupplementaires ?? [];
  const echecForme = verifierFormeMotifs(valeur);
  if (echecForme !== null) return echecForme;
  // `verifierFormeMotifs` a déjà prouvé la forme (y compris `.every(estFormeMoti)`)
  // avant de rendre `null` ; le narrowing ne traverse pas l'appel de fonction, d'où
  // ce cast borné à cette seule ligne.
  return appliquerGardesFouPlancher(valeur as readonly MotifDeni[]);
}

interface ValidationsCollectees {
  readonly idRes: ReturnType<typeof validerId>;
  readonly cheminRes: Awaited<ReturnType<typeof validerChemin>>;
  readonly brancheInfo: Awaited<ReturnType<typeof validerBranche>> | null;
  readonly budgetRes: ReturnType<typeof validerBudget>;
  readonly modeleRes: ReturnType<typeof validerModele>;
  readonly motifsRes: ReturnType<typeof validerMotifsSupplementaires>;
  readonly echecs: readonly EchecValidationProjet[];
}

/** Exécute tous les contrôles indépendants et agrège leurs échecs (F.4.2). */
async function collecterValidations(b: ConfigProjetBrute, deps: DependancesValidation): Promise<ValidationsCollectees> {
  const idRes = validerId(b);
  const cheminRes = await validerChemin(b.cheminDepot);
  // La vérification de branche exige un chemin résolu ; sans lui, elle est sautée
  // plutôt que de produire une erreur en cascade illisible.
  const brancheInfo = cheminRes.chemin !== null ? await validerBranche(b, cheminRes.chemin, deps.interrogateurGit) : null;
  const budgetRes = validerBudget(b);
  const modeleRes = validerModele(b);
  const motifsRes = validerMotifsSupplementaires(b);

  const echecs = [
    ...idRes.echecs,
    ...cheminRes.echecs,
    ...(brancheInfo?.echecs ?? []),
    ...budgetRes.echecs,
    ...modeleRes.echecs,
    ...motifsRes.echecs,
  ];
  return { idRes, cheminRes, brancheInfo, budgetRes, modeleRes, motifsRes, echecs };
}

function assemblerConfig(v: ValidationsCollectees, b: ConfigProjetBrute, fichierSource: string): ConfigProjet {
  // ☠ N'est appelée qu'après confirmation que tous les champs requis sont non nuls
  // (voir le garde en tête de `validerConfigProjet`) — les `!` sont donc sûrs ici.
  const brancheInfo = v.brancheInfo!;
  return {
    id: v.idRes.id!,
    cheminDepot: v.cheminRes.chemin!,
    estGit: brancheInfo.estGit,
    brancheDefaut: brancheInfo.branche,
    budgetMaxUsd: v.budgetRes.budget!,
    modeleDefaut: v.modeleRes.modele!,
    deniedToolPatternsSupplementaires: v.motifsRes.motifs,
    agentTeamsActif: b.agentTeamsActif === true,
    mandatType: typeof b.mandatType === 'string' && b.mandatType.trim().length > 0 ? b.mandatType : 'standard',
    isolationGarantie: brancheInfo.estGit,
    fichierSource,
  };
}

/**
 * Valide une configuration brute et construit un `ConfigProjet` complet, ou
 * retourne la liste **exhaustive** des échecs — jamais les deux mélangés.
 */
export async function validerConfigProjet(
  brute: unknown,
  fichierSource: string,
  deps: DependancesValidation,
): Promise<ResultatValidationProjet> {
  if (typeof brute !== 'object' || brute === null || Array.isArray(brute)) {
    return { config: null, echecs: [echec('forme_invalide', 'la configuration doit être un objet JSON.')] };
  }
  // `ConfigProjetBrute` n'a que des champs optionnels : le garde ci-dessus prouve
  // « objet non-tableau », qui est tout ce que la forme exige structurellement.
  // Chaque champ est ensuite vérifié individuellement par `collecterValidations`.
  const b = brute as ConfigProjetBrute;
  const v = await collecterValidations(b, deps);

  const complet =
    v.idRes.id !== null && v.cheminRes.chemin !== null && v.brancheInfo !== null && v.budgetRes.budget !== null && v.modeleRes.modele !== null;
  if (v.echecs.length > 0 || !complet) {
    return { config: null, echecs: v.echecs };
  }
  return { config: assemblerConfig(v, b, fichierSource), echecs: [] };
}
