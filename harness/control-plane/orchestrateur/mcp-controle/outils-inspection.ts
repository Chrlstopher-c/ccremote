/**
 * Responsabilité : groupe « inspection » de la surface d'outils (A.2.2) — lecture
 * seule, auto-approuvable (`readOnlyHint`). Délègue à E (registre) et F (projets).
 *
 * ☠ (d) Aucune fonction ici ne laisse une exception s'échapper : le registre
 * (E) rejette en `ErreurRegistre`, `chargerProjets` peut rejeter sur un
 * répertoire illisible — les deux sont interceptés, jamais relancés.
 */

import {
  InterrogateurGitReel,
  chargerProjets,
  type ConfigProjet,
  type InterrogateurGit,
  type ProjetRejete,
} from '../../../projets/index.ts';
import type { Mission, Registre } from '../../registre/index.ts';
import { applique, echecInattendu } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour, LecteurEscalades } from './types.ts';

function resumerMission(m: Mission): string {
  return `${m.id} · ${m.nom} · projet=${m.projet} · harness=${m.etatHarness} · sdk=${m.etatSdk ?? 'inconnu'}`;
}

/** `lister_equipes` (A.2.2) — quelles équipes, quels états. Résumé, jamais le flux brut (H-45). */
export function listerEquipes(registre: Registre): ContratRetour {
  try {
    const missions = registre.missions.listerActives();
    const resume = missions.length === 0 ? 'aucune équipe active' : missions.map(resumerMission).join(' | ');
    return applique('lister les équipes actives', resume);
  } catch (erreur) {
    journal.error({ err: erreur }, 'lister_equipes en échec');
    return echecInattendu('lister les équipes actives', erreur);
  }
}

/** `etat_equipe` (A.2.2) — détail d'une équipe : tâche, coût, contexte, capacités manquantes. */
export function etatEquipe(registre: Registre, missionId: string): ContratRetour {
  try {
    const mission = registre.missions.lire(missionId);
    if (mission === null) return { ok: false, intention: `état de ${missionId}`, effet: 'refuse', raison: 'mission introuvable' };
    const manquantes = registre.capacites.manquantesSurveillees(missionId);
    const etat = [
      resumerMission(mission),
      `budget=${mission.budgetConsommeUsd}/${mission.budgetMaxUsd ?? '∞'} USD`,
      `contexte=${mission.contexteTokensUtilises ?? '?'}/${mission.contexteTokensMax ?? '?'}`,
      manquantes.length > 0 ? `capacités manquantes: ${manquantes.join(', ')}` : 'capacités surveillées toutes présentes',
    ].join(' · ');
    return applique(`état de ${missionId}`, etat);
  } catch (erreur) {
    journal.error({ err: erreur, missionId }, 'etat_equipe en échec');
    return echecInattendu(`état de ${missionId}`, erreur);
  }
}

function resumerProjet(p: ConfigProjet): string {
  return `${p.id} (${p.isolationGarantie ? 'worktree' : 'dégradé — isolation NON garantie'})`;
}

function resumerRejet(r: ProjetRejete): string {
  return `${r.idPresume ?? r.fichierSource} rejeté: ${r.echecs.map((e) => e.code).join(', ')}`;
}

/**
 * `lister_projets` (A.2.2) — projets connus et leur worktree. Délègue à F.
 * `interrogateurGit` injectable pour le test, réel par défaut — même motif que
 * `DependancesChargeur` de `projets/chargeur-projets.ts`.
 */
export async function listerProjets(
  repertoireProjets: string,
  interrogateurGit: InterrogateurGit = new InterrogateurGitReel(),
): Promise<ContratRetour> {
  const intention = 'lister les projets connus';
  try {
    const resultat = await chargerProjets(repertoireProjets, { interrogateurGit });
    const parties = [
      resultat.projets.length === 0 ? 'aucun projet valide' : resultat.projets.map(resumerProjet).join(' | '),
      ...(resultat.rejetes.length > 0 ? [`rejetés: ${resultat.rejetes.map(resumerRejet).join(' | ')}`] : []),
    ];
    return applique(intention, parties.join(' — '));
  } catch (erreur) {
    journal.error({ err: erreur, repertoireProjets }, 'lister_projets en échec');
    return echecInattendu(intention, erreur);
  }
}

/** `historique_equipe` (A.2.2) — dernières transitions d'état, résumées (jamais le flux brut). */
export function historiqueEquipe(registre: Registre, missionId: string, limite = 20): ContratRetour {
  const intention = `historique de ${missionId}`;
  try {
    const transitions = registre.etats.historique(missionId, limite);
    if (transitions.length === 0) return applique(intention, 'aucune transition connue');
    const resume = transitions
      .map((t) => `[${t.origine}] ${t.etatPrecedent ?? '∅'} → ${t.etatNouveau}${t.motif ? ` (${t.motif})` : ''}`)
      .join(' | ');
    return applique(intention, resume);
  } catch (erreur) {
    journal.error({ err: erreur, missionId }, 'historique_equipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/** `permissions_en_attente` (A.2.2) — ce qui bloque, et depuis quand. Délègue à C. */
export function permissionsEnAttente(escalades: LecteurEscalades): ContratRetour {
  const intention = 'lister les permissions en attente';
  try {
    const enAttente = escalades.enAttente();
    if (enAttente.length === 0) return applique(intention, 'aucune escalade en attente');
    const resume = enAttente
      .map((d) => `${d.requestId} · ${d.outil} · équipe=${d.idWorker} · depuis=${d.enAttenteDepuisA ?? '?'}`)
      .join(' | ');
    return applique(intention, resume);
  } catch (erreur) {
    journal.error({ err: erreur }, 'permissions_en_attente en échec');
    return echecInattendu(intention, erreur);
  }
}
