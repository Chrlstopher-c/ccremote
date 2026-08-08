/**
 * Responsabilité : orchestrer une passe d'extraction de leçons (C-3, SPEC §5) — compose le
 * prompt, appelle le client d'inférence, passe la garde de sortie, applique le filtre
 * déterministe de la liste négative. Ne touche jamais `apprentissage.db` : le rapprochement
 * (C-5, `rapprochement.ts`) est seul à écrire.
 *
 * `☠` Jamais d'exception qui remonte — un échec à n'importe quelle étape (modèle
 * indisponible, sortie rejetée) rend un résultat vide avec un motif, jamais une exception :
 * c'est le contrat qui protège la clôture d'une mission (SPEC §1).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { journal } from '../logger.ts';
import type { Lecon, ResumeMission } from '../types.ts';
import type { ClientInference } from './client-inference.ts';
import { validerLeconsExtraites, type LeconExtraite } from './garde-sortie.ts';
import { construirePromptExtraction } from './prompts.ts';

export interface ResultatExtraction {
  readonly lecons: readonly LeconExtraite[];
  /** Motifs des leçons rejetées par le filtre déterministe ou la garde — pour le journal. */
  readonly motifsRejetes: readonly string[];
  /** Non `null` ⇒ la passe n'a produit aucune leçon à cause de ceci (modèle, garde). */
  readonly erreur: string | null;
}

/** Reconnaît un identifiant de mission, une date ISO ou une branche `equipe/<uuid>` (SPEC §5.3, interdit 5). */
const MOTIF_IDENTIFIANT_MISSION =
  /\b\d{4}-\d{2}-\d{2}\b|\bmission[-_ ][0-9a-f]{3,}\b|\bequipe\/[0-9a-f-]{8,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** Reconnaît une affirmation négative sur un outil en tête d'énoncé (SPEC §5.3, interdit 2) : « X ne verbe pas ». */
const MOTIF_NEGATION_OUTIL_EN_TETE = /^\S+\s+ne\s+\S+\s+pas\b/i;

function motifListeNegative(lecon: LeconExtraite): string | null {
  if (MOTIF_IDENTIFIANT_MISSION.test(lecon.enonce)) {
    return 'nomme une mission, une date ou une branche — n’a de sens que pour cette mission-là (interdit 5)';
  }
  if (MOTIF_NEGATION_OUTIL_EN_TETE.test(lecon.enonce)) {
    return 'affirmation négative sur un outil en tête d’énoncé — motif qui se durcit en refus permanent (interdit 2)';
  }
  return null;
}

/**
 * Filtre déterministe de la liste négative (SPEC §5.3, `☠`) — rattrape après coup ce que le
 * prompt demande déjà au modèle de s'interdire ; une leçon qui enfreint est rejetée même si
 * le modèle l'a produite.
 */
export function respecteListeNegative(lecon: LeconExtraite): { readonly ok: true } | { readonly ok: false; readonly motif: string } {
  const motif = motifListeNegative(lecon);
  return motif === null ? { ok: true } : { ok: false, motif };
}

/**
 * Exécute une passe d'extraction (C-3) : prompt → modèle → garde → filtre. Ne lève jamais ;
 * toute panne rend `{ lecons: [], erreur: "..." }`.
 */
export async function extraireLecons(
  client: ClientInference,
  resume: ResumeMission,
  leconsActives: readonly Lecon[],
): Promise<ResultatExtraction> {
  const prompt = construirePromptExtraction(resume, leconsActives);
  const reponse = await client.appelerModele({ prompt });
  if (!reponse.disponible) {
    journal.warn({ missionId: resume.missionId, motif: reponse.motif }, 'extraction différée — modèle indisponible');
    return { lecons: [], motifsRejetes: [], erreur: `modèle indisponible : ${reponse.motif}` };
  }

  const verdict = validerLeconsExtraites(reponse.contenu);
  if (!verdict.accepte) {
    journal.warn({ missionId: resume.missionId, motif: verdict.motif }, 'sortie du modèle rejetée par la garde');
    return { lecons: [], motifsRejetes: [], erreur: `sortie rejetée : ${verdict.motif}` };
  }

  const motifsRejetes: string[] = [];
  const lecons = verdict.valeur.filter((lecon) => {
    const verdictFiltre = respecteListeNegative(lecon);
    if (verdictFiltre.ok) return true;
    motifsRejetes.push(`« ${lecon.enonce} » — ${verdictFiltre.motif}`);
    return false;
  });
  if (motifsRejetes.length > 0) {
    journal.info({ missionId: resume.missionId, motifsRejetes }, 'leçons rejetées par le filtre déterministe');
  }
  return { lecons, motifsRejetes, erreur: null };
}
