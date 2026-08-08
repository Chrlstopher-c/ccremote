/**
 * Responsabilité : rapprocher les leçons fraîchement extraites (C-3) de l'existant du même
 * projet (C-5, SPEC §5) — confirmation, contradiction, ou création d'une leçon `candidate`.
 * C'est le garde-fou n°1 qui remplace la relecture humaine que Hermes obtient gratuitement.
 *
 * `☠` Le rapprochement est D'ABORD lexical (`similarite-lexicale.ts`) ; le modèle n'est
 * appelé que pour les cas ambigus (similarité ni nette ni nulle). En zone grise, ce module
 * choisit la sûreté : `aucun_rapport` (nouvelle leçon `candidate`), jamais un match forcé —
 * une leçon fausse promue coûte plus cher qu'une leçon vraie non détectée (SPEC §8).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { confirmerLecon, contredireLecon, creerLecon, enregistrerObservation, listerLeconsParProjet } from '../base/lecons.ts';
import { journal } from '../logger.ts';
import type { Lecon } from '../types.ts';
import type { ClientInference } from './client-inference.ts';
import { validerVerdictRapprochement } from './garde-sortie.ts';
import type { LeconExtraite } from './garde-sortie.ts';
import { negationDivergente, SEUIL_SIMILARITE_FAIBLE, SEUIL_SIMILARITE_FORTE, similarite } from './similarite-lexicale.ts';

export type ActionRapprochement = 'nouvelle' | 'confirmee' | 'contredite';

export interface ResultatRapprochementUnitaire {
  readonly action: ActionRapprochement;
  readonly leconId: string;
  readonly promue: boolean;
  readonly retrogradee: boolean;
}

export interface ParametresRapprochement {
  readonly db: Database;
  readonly client: ClientInference;
  readonly projet: string;
  readonly missionId: string;
  readonly lecons: readonly LeconExtraite[];
  readonly maintenant?: number;
}

interface Correspondance {
  readonly lecon: Lecon;
  readonly relation: 'confirme' | 'contredit';
}

/** Leçons éligibles au rapprochement : jamais `obsolete`, qui est une décision arbitrée. */
function candidatesAuRapprochement(db: Database, projet: string): readonly Lecon[] {
  return listerLeconsParProjet(db, projet).filter((l) => l.etat !== 'obsolete');
}

function construirePromptRapprochement(nouvelle: string, existante: string): string {
  return [
    'Deux énoncés de leçon issus de missions différentes sur le même projet.',
    `A (nouvelle) : ${nouvelle}`,
    `B (existante) : ${existante}`,
    '',
    "Parlent-ils du MÊME fait ? Si oui, A confirme-t-il B, ou le contredit-il (l'un dit",
    "l'inverse de l'autre) ? Réponds UNIQUEMENT ce JSON, rien d'autre :",
    '{"relation": "confirme"|"contredit"|"aucun_rapport"}',
  ].join('\n');
}

/** Départage un cas ambigu (similarité ni nette ni nulle) en appelant le modèle. Jamais de repli forcé. */
async function departagerParModele(
  client: ClientInference,
  nouvelle: string,
  existante: string,
): Promise<'confirme' | 'contredit' | 'aucun_rapport'> {
  const reponse = await client.appelerModele({ prompt: construirePromptRapprochement(nouvelle, existante) });
  if (!reponse.disponible) return 'aucun_rapport';
  const verdict = validerVerdictRapprochement(reponse.contenu);
  if (!verdict.accepte) {
    journal.warn({ motif: verdict.motif }, 'verdict de rapprochement rejeté par la garde — traité comme aucun rapport');
    return 'aucun_rapport';
  }
  return verdict.valeur.relation;
}

/**
 * Cherche, parmi les leçons existantes du projet, celle que `lecon` confirme ou contredit.
 * `null` ⇒ aucun rapport, la leçon est nouvelle. `doublonDe` (SPEC §5.3) est essayé en
 * premier : le modèle a lui-même désigné la leçon visée, encore faut-il qu'elle existe.
 */
async function trouverCorrespondance(
  client: ClientInference,
  lecon: LeconExtraite,
  existantes: readonly Lecon[],
): Promise<Correspondance | null> {
  if (lecon.doublonDe !== null) {
    const visee = existantes.find((l) => l.id === lecon.doublonDe);
    if (visee !== undefined) return { lecon: visee, relation: 'confirme' };
    // Référence invalide (SPEC §5.3 `☠` : sortie de modèle = entrée non fiable) — on retombe
    // sur la comparaison lexicale plutôt que de créer une leçon avec un lien mort.
  }

  let meilleure: { readonly lecon: Lecon; readonly score: number } | null = null;
  for (const existante of existantes) {
    const score = similarite(lecon.enonce, existante.enonce);
    if (meilleure === null || score > meilleure.score) meilleure = { lecon: existante, score };
  }
  if (meilleure === null || meilleure.score < SEUIL_SIMILARITE_FAIBLE) return null;

  if (meilleure.score >= SEUIL_SIMILARITE_FORTE) {
    const relation = negationDivergente(lecon.enonce, meilleure.lecon.enonce) ? 'contredit' : 'confirme';
    return { lecon: meilleure.lecon, relation };
  }

  // Zone grise (SEUIL_SIMILARITE_FAIBLE ≤ score < SEUIL_SIMILARITE_FORTE) : le modèle tranche.
  const relation = await departagerParModele(client, lecon.enonce, meilleure.lecon.enonce);
  if (relation === 'aucun_rapport') return null;
  return { lecon: meilleure.lecon, relation };
}

/**
 * Rapproche chaque leçon extraite de l'existant du même projet (C-5). Jamais bloquant :
 * une panne du modèle sur un cas ambigu retombe sur « aucun rapport » (nouvelle candidate),
 * jamais sur une exception.
 */
export async function rapprocherLecons(parametres: ParametresRapprochement): Promise<readonly ResultatRapprochementUnitaire[]> {
  const { db, client, projet, missionId, lecons } = parametres;
  const maintenant = parametres.maintenant ?? Date.now();
  const resultats: ResultatRapprochementUnitaire[] = [];

  for (const lecon of lecons) {
    const existantes = candidatesAuRapprochement(db, projet);
    const correspondance = await trouverCorrespondance(client, lecon, existantes);

    if (correspondance === null) {
      const id = randomUUID();
      creerLecon(db, {
        id,
        projet,
        enonce: lecon.enonce,
        categorie: lecon.categorie,
        portee: lecon.portee,
        creeeA: maintenant,
      });
      // La mission d'origine COMPTE comme sa première confirmation (SPEC C-5) mais
      // `creerLecon` la fixe déjà à 1 sans ligne `lecon_observation` — on l'écrit ici pour
      // que l'idempotence par mission (`confirmerLecon`) la détecte si cette même mission
      // était un jour rapprochée une seconde fois sur cette même leçon (SPEC §5.7 `☠`).
      enregistrerObservation(db, { leconId: id, missionId, sens: 'confirme', preuve: lecon.preuve, observeeA: maintenant });
      resultats.push({ action: 'nouvelle', leconId: id, promue: false, retrogradee: false });
      continue;
    }

    if (correspondance.relation === 'confirme') {
      const { lecon: misAJour, promue } = confirmerLecon(db, correspondance.lecon.id, missionId, lecon.preuve, maintenant);
      resultats.push({ action: 'confirmee', leconId: misAJour.id, promue, retrogradee: false });
    } else {
      const { lecon: misAJour, retrogradee } = contredireLecon(db, correspondance.lecon.id, missionId, lecon.preuve, maintenant);
      resultats.push({ action: 'contredite', leconId: misAJour.id, promue: false, retrogradee });
    }
  }

  return resultats;
}
