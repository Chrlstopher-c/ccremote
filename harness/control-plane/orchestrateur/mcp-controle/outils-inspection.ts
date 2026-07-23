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

/** Combien d'équipes terminées restent visibles à l'orchestrateur — les récentes suffisent. */
const TERMINEES_VISIBLES = 15;

/**
 * `☠` Une équipe TERMINÉE doit rester interrogeable. `lister_equipes` ne rendait
 * que `listerActives()` : à la seconde où une mission s'achevait, elle
 * disparaissait de tout ce que l'orchestrateur peut voir. Il répondait donc
 * « équipe introuvable » à l'opérateur qui venait de la voir finir sous ses yeux
 * — constaté le 23/07. Une équipe qui vient de se terminer est précisément celle
 * dont on veut le bilan.
 */
export function listerEquipes(registre: Registre): ContratRetour {
  try {
    const recentes = registre.missions.listerRecentes(200);
    const actives = new Set(registre.missions.listerActives().map((m) => m.id));
    const vivantes = recentes.filter((m) => actives.has(m.id));
    const terminees = recentes.filter((m) => !actives.has(m.id)).slice(0, TERMINEES_VISIBLES);
    const parties = [
      vivantes.length === 0 ? 'aucune équipe active' : `actives: ${vivantes.map(resumerMission).join(' | ')}`,
      ...(terminees.length > 0 ? [`terminées récentes: ${terminees.map(resumerMission).join(' | ')}`] : []),
    ];
    return applique('lister les équipes', parties.join(' — '));
  } catch (erreur) {
    journal.error({ err: erreur }, 'lister_equipes en échec');
    return echecInattendu('lister les équipes', erreur);
  }
}

export type ResolutionMission =
  | { readonly trouve: Mission }
  | { readonly ambigu: readonly Mission[] }
  | { readonly absent: true };

/**
 * Résout une désignation d'équipe : identifiant exact, sinon nom, sinon projet,
 * sinon fragment de l'un des trois.
 *
 * `☠` L'opérateur désigne une équipe par son NOM — c'est ce qu'il lit à l'écran.
 * N'accepter que l'identifiant obligeait l'orchestrateur à répondre
 * « introuvable » sur une équipe parfaitement existante (23/07). Une
 * correspondance ambiguë n'est jamais tranchée au hasard : on rend les
 * candidats, l'orchestrateur redemande.
 */
export function resoudreMission(registre: Registre, designation: string): ResolutionMission {
  const exact = registre.missions.lire(designation);
  if (exact !== null) return { trouve: exact };
  const aiguille = designation.trim().toLowerCase();
  if (aiguille.length === 0) return { absent: true };
  const candidats = registre.missions.listerRecentes(200);
  const parChamp = candidats.filter(
    (m) => m.nom.toLowerCase() === aiguille || m.projet.toLowerCase() === aiguille,
  );
  const retenus =
    parChamp.length > 0
      ? parChamp
      : candidats.filter(
          (m) =>
            m.id.toLowerCase().includes(aiguille) ||
            m.nom.toLowerCase().includes(aiguille) ||
            m.projet.toLowerCase().includes(aiguille),
        );
  if (retenus.length === 0) return { absent: true };
  // `listerRecentes` trie par activité décroissante : le premier est le plus récent.
  if (retenus.length === 1) return { trouve: retenus[0] as Mission };
  return { ambigu: retenus.slice(0, 10) };
}

/** `etat_equipe` (A.2.2) — détail d'une équipe : tâche, coût, contexte, capacités manquantes. */
export function etatEquipe(registre: Registre, designation: string): ContratRetour {
  const intention = `état de ${designation}`;
  try {
    const resolution = resoudreMission(registre, designation);
    if ('absent' in resolution) {
      return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe ne correspond à cette désignation' };
    }
    if ('ambigu' in resolution) {
      const listeCandidats = resolution.ambigu.map((m) => `${m.id} (${m.nom})`).join(' | ');
      return {
        ok: false,
        intention,
        effet: 'refuse',
        raison: `désignation ambiguë — préciser l'identifiant parmi : ${listeCandidats}`,
      };
    }
    const mission = resolution.trouve;
    const manquantes = registre.capacites.manquantesSurveillees(mission.id);
    const etat = [
      resumerMission(mission),
      `budget=${mission.budgetConsommeUsd}/${mission.budgetMaxUsd ?? '∞'} USD`,
      `contexte=${mission.contexteTokensUtilises ?? '?'}/${mission.contexteTokensMax ?? '?'}`,
      manquantes.length > 0 ? `capacités manquantes: ${manquantes.join(', ')}` : 'capacités surveillées toutes présentes',
    ].join(' · ');
    return applique(intention, etat);
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'etat_equipe en échec');
    return echecInattendu(intention, erreur);
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
export function historiqueEquipe(registre: Registre, designation: string, limite = 20): ContratRetour {
  const intention = `historique de ${designation}`;
  try {
    const resolution = resoudreMission(registre, designation);
    if (!('trouve' in resolution)) {
      return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe ne correspond à cette désignation' };
    }
    const missionId = resolution.trouve.id;
    const transitions = registre.etats.historique(missionId, limite);
    if (transitions.length === 0) return applique(intention, 'aucune transition connue');
    const resume = transitions
      .map((t) => `[${t.origine}] ${t.etatPrecedent ?? '∅'} → ${t.etatNouveau}${t.motif ? ` (${t.motif})` : ''}`)
      .join(' | ');
    return applique(intention, resume);
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'historique_equipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `rapport_equipe` — ce que l'équipe a RÉELLEMENT écrit.
 *
 * `☠` H-45 interdit de déverser le flux brut d'un worker dans le contexte de
 * l'orchestrateur, et cet outil ne le fait pas : il rend les textes que le lead a
 * produits, déjà bornés à l'écriture, et seulement les derniers. Sans lui,
 * l'orchestrateur n'avait accès qu'aux états et compteurs — il pouvait dire
 * qu'une équipe avait fini, jamais ce qu'elle avait trouvé (constaté le 23/07).
 */
export function rapportEquipe(registre: Registre, designation: string): ContratRetour {
  const intention = `rapport de ${designation}`;
  try {
    const resolution = resoudreMission(registre, designation);
    if (!('trouve' in resolution)) {
      return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe ne correspond à cette désignation' };
    }
    const dernier = registre.missions.dernierTexte(resolution.trouve.id);
    if (dernier === null) {
      return applique(intention, "aucun texte produit n'a encore été rapatrié pour cette équipe");
    }
    // `☠` ENTIER, jamais tronqué : c'est la synthèse de fin de l'équipe. En
    // couper la moitié la rend inutilisable — décision de l'opérateur (23/07).
    return applique(intention, dernier.texte);
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'rapport_equipe en échec');
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
