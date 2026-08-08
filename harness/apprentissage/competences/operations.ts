/**
 * Responsabilité : application déterministe d'une `OperationCompetence` déjà validée par
 * `garde-sortie.ts` (C-8, SPEC §5.8 `☠`) — le modèle ne produit JAMAIS de contenu de fichier,
 * il propose une opération dans une liste fermée ; ce module décide (seuils de convergence,
 * existence du slug) et délègue l'écriture réelle à `depot-competences.ts`. Aucune exécution :
 * ni substitution de variable, ni shell — une compétence est du texte lu par un lead.
 *
 * `☠` PLAN-PORTAGE.md E8 : `creer` exige TROIS leçons `active` convergentes (même catégorie,
 * vocabulaire partagé) ; `ajouter_piege` en exige UNE. Ne pas relâcher ces seuils — c'est la
 * prévention documentée par Hermes lui-même contre une bibliothèque de compétences étroites.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { journal } from '../logger.ts';
import { similarite } from '../extraction/similarite-lexicale.ts';
import type { Competence, Lecon, OperationCompetence } from '../types.ts';
import { ecrireCompetence, lireCompetence, slugifier, type CorpsCompetence } from './depot-competences.ts';

/** PLAN-PORTAGE.md E8 `☠` : trois leçons `active` convergentes pour CRÉER. */
export const SEUIL_LECONS_CREATION = 3;
/** PLAN-PORTAGE.md E8 `☠` : une seule leçon `active` pour un PIÈGE. */
export const SEUIL_LECONS_PIEGE = 1;

/** Recouvrement lexical moyen minimal exigé entre les leçons d'un groupe « convergent » (SPEC §5.8). */
const SEUIL_CONVERGENCE_VOCABULAIRE = 0.08;
const MAX_LIGNE = 200;

export type ResultatOperationCompetence =
  | { readonly appliquee: true; readonly slug: string; readonly action: 'creee' | 'piege_ajoute' | 'etape_ajoutee' }
  | { readonly appliquee: false; readonly motif: string };

export interface ContexteOperationCompetence {
  readonly racine: string;
  readonly projet: string;
  /** Leçons `active` avancées à l'appui de l'opération (SPEC §5.8 : « leçons active convergentes »). */
  readonly leconsAppui: readonly Lecon[];
  /** Date ISO (YYYY-MM-DD) à écrire dans `maj`. Défaut : aujourd'hui. */
  readonly maintenant?: string;
  /** Identifiants de mission à l'origine — best-effort, vide si non fourni par l'appelant. */
  readonly origineMissions?: readonly string[];
}

function dateIso(maintenant?: string): string {
  return maintenant ?? new Date().toISOString().slice(0, 10);
}

function moyenneSimilaritePaires(enonces: readonly string[]): number {
  if (enonces.length < 2) return 1;
  let somme = 0;
  let paires = 0;
  for (let i = 0; i < enonces.length; i += 1) {
    for (let j = i + 1; j < enonces.length; j += 1) {
      somme += similarite(enonces[i]!, enonces[j]!);
      paires += 1;
    }
  }
  return paires === 0 ? 0 : somme / paires;
}

type Verdict = { readonly ok: true } | { readonly ok: false; readonly motif: string };

/** SPEC §5.8 : « trois leçons `active` du même projet partagent une catégorie et un vocabulaire ». */
function verifierConvergence(lecons: readonly Lecon[], seuil: number): Verdict {
  if (lecons.length < seuil) {
    return { ok: false, motif: `${seuil} leçon(s) active(s) convergente(s) exigée(s), reçu ${lecons.length}` };
  }
  if (!lecons.every((l) => l.etat === 'active')) {
    return { ok: false, motif: 'toutes les leçons à l’appui doivent être à l’état « active »' };
  }
  const categorie = lecons[0]!.categorie;
  if (!lecons.every((l) => l.categorie === categorie)) {
    return { ok: false, motif: 'les leçons à l’appui ne partagent pas la même catégorie' };
  }
  if (seuil > 1) {
    const moyenne = moyenneSimilaritePaires(lecons.map((l) => l.enonce));
    if (moyenne < SEUIL_CONVERGENCE_VOCABULAIRE) {
      return {
        ok: false,
        motif: `les leçons à l’appui ne partagent pas assez de vocabulaire (recouvrement ${moyenne.toFixed(2)} < ${SEUIL_CONVERGENCE_VOCABULAIRE})`,
      };
    }
  }
  return { ok: true };
}

function validerLigne(ligne: string): Verdict {
  if (ligne.length === 0 || ligne.length > MAX_LIGNE) {
    return { ok: false, motif: `« ligne » doit tenir entre 1 et ${MAX_LIGNE} caractères (reçu ${ligne.length})` };
  }
  return { ok: true };
}

function appliquerCreation(
  contexte: ContexteOperationCompetence,
  operation: Extract<OperationCompetence, { type: 'creer' }>,
): ResultatOperationCompetence {
  const convergence = verifierConvergence(contexte.leconsAppui, SEUIL_LECONS_CREATION);
  if (!convergence.ok) return { appliquee: false, motif: convergence.motif };

  const slug = slugifier(operation.nom);
  if (lireCompetence(contexte.racine, slug) !== null) {
    return { appliquee: false, motif: `compétence « ${slug} » existe déjà — utiliser ajouter_piege ou ajouter_etape` };
  }
  const competence: Competence = {
    slug,
    nom: operation.nom,
    description: operation.description,
    portee: 'projet',
    projet: contexte.projet,
    etat: 'active',
    confirmations: contexte.leconsAppui.length,
    origine: contexte.origineMissions ?? [],
    maj: dateIso(contexte.maintenant),
  };
  const corps: CorpsCompetence = { quand: operation.quand, etapes: operation.etapes, pieges: [] };
  ecrireCompetence(contexte.racine, { competence, corps });
  journal.info({ slug, projet: contexte.projet }, 'compétence créée (C-8)');
  return { appliquee: true, slug, action: 'creee' };
}

function appliquerAjoutPiege(
  contexte: ContexteOperationCompetence,
  operation: Extract<OperationCompetence, { type: 'ajouter_piege' }>,
): ResultatOperationCompetence {
  const ligneValide = validerLigne(operation.ligne);
  if (!ligneValide.ok) return { appliquee: false, motif: ligneValide.motif };
  const convergence = verifierConvergence(contexte.leconsAppui, SEUIL_LECONS_PIEGE);
  if (!convergence.ok) return { appliquee: false, motif: convergence.motif };

  const fichier = lireCompetence(contexte.racine, operation.slug);
  if (fichier === null) {
    return { appliquee: false, motif: `compétence « ${operation.slug} » introuvable — aucune écriture` };
  }
  const corps: CorpsCompetence = { ...fichier.corps, pieges: [...fichier.corps.pieges, operation.ligne] };
  const competence: Competence = { ...fichier.competence, maj: dateIso(contexte.maintenant) };
  ecrireCompetence(contexte.racine, { competence, corps });
  journal.info({ slug: operation.slug }, 'piège ajouté à une compétence (C-8)');
  return { appliquee: true, slug: operation.slug, action: 'piege_ajoute' };
}

function appliquerAjoutEtape(
  contexte: ContexteOperationCompetence,
  operation: Extract<OperationCompetence, { type: 'ajouter_etape' }>,
): ResultatOperationCompetence {
  const ligneValide = validerLigne(operation.ligne);
  if (!ligneValide.ok) return { appliquee: false, motif: ligneValide.motif };
  const fichier = lireCompetence(contexte.racine, operation.slug);
  if (fichier === null) {
    return { appliquee: false, motif: `compétence « ${operation.slug} » introuvable — aucune écriture` };
  }
  if (operation.apresEtape < 0 || operation.apresEtape > fichier.corps.etapes.length) {
    return {
      appliquee: false,
      motif: `« apresEtape » hors bornes (0..${fichier.corps.etapes.length}), reçu ${operation.apresEtape}`,
    };
  }
  const etapes = [...fichier.corps.etapes];
  etapes.splice(operation.apresEtape, 0, operation.ligne);
  const competence: Competence = { ...fichier.competence, maj: dateIso(contexte.maintenant) };
  ecrireCompetence(contexte.racine, { competence, corps: { ...fichier.corps, etapes } });
  journal.info({ slug: operation.slug }, 'étape ajoutée à une compétence (C-8)');
  return { appliquee: true, slug: operation.slug, action: 'etape_ajoutee' };
}

/**
 * Applique une `OperationCompetence` déjà validée en FORME par `garde-sortie.ts` (C-8).
 * Ne lève jamais : toute panne (disque, seuil non atteint, slug inexistant) rend
 * `{ appliquee: false, motif }`, jamais une exception — même contrat que le reste du domaine.
 */
export function appliquerOperationCompetence(
  contexte: ContexteOperationCompetence,
  operation: OperationCompetence,
): ResultatOperationCompetence {
  try {
    switch (operation.type) {
      case 'rien':
        return { appliquee: false, motif: 'aucune opération proposée (rien)' };
      case 'creer':
        return appliquerCreation(contexte, operation);
      case 'ajouter_piege':
        return appliquerAjoutPiege(contexte, operation);
      case 'ajouter_etape':
        return appliquerAjoutEtape(contexte, operation);
      default: {
        // Exhaustivité TS : toute variante future non gérée casse la compilation ici, avant
        // le runtime. En pratique inatteignable — `garde-sortie.ts` filtre déjà en amont.
        const exhaustif: never = operation;
        return { appliquee: false, motif: `opération inconnue — reçu ${JSON.stringify(exhaustif)}` };
      }
    }
  } catch (cause) {
    journal.error({ err: cause }, 'application d’une opération de compétence en échec — non bloquant');
    return { appliquee: false, motif: cause instanceof Error ? cause.message : String(cause) };
  }
}

