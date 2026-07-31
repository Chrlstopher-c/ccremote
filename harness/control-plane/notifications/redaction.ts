/**
 * Responsabilité : transformer un fait du parc en deux textes — celui que Chris
 * lit dans l'interface, et celui que l'orchestrateur reçoit dans son fil.
 *
 * Pur, aucune I/O. Séparé de la détection parce que ce sont deux raisons de
 * changer différentes : quand ajouter une notification, et quoi écrire dedans.
 *
 * `☠` Le texte destiné à l'orchestrateur est un PROMPT, pas un libellé. Il
 * arrive dans son contexte comme n'importe quel message et le fait agir. Trois
 * exigences qui en découlent, et qui expliquent chaque ligne de ce fichier :
 *   1. il dit d'où il vient (le harness, pas Chris — H-66) ;
 *   2. il donne l'identifiant exact que ses outils attendent, sinon le premier
 *      geste utile lui coûte un aller-retour de recherche ;
 *   3. il dit ce qui est attendu de lui, sinon un modèle poli répond « bien
 *      noté » et le fil s'arrête là.
 */

import type { Mission, TypeNotification } from '../registre/index.ts';

export interface TexteNotification {
  readonly titre: string;
  /** Ce que Chris lit dans la liste. Court, factuel. */
  readonly corps: string;
  /** Ce que l'orchestrateur reçoit dans son fil. Rédigé comme une consigne. */
  readonly pourOrchestrateur: string;
}

/** Coût affiché en dollars, deux décimales — jamais une notation exponentielle. */
function cout(usd: number): string {
  return `${usd.toFixed(2)} $`;
}

function duree(debutMs: number | null, finMs: number): string {
  if (debutMs === null) return 'durée inconnue';
  const minutes = Math.max(0, Math.round((finMs - debutMs) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Une équipe a rendu sa réponse.
 *
 * `☠` « Terminée » veut dire « le lead a fini de parler », pas « l'objectif est
 * atteint ». La distinction est portée par le texte : on demande à
 * l'orchestrateur de LIRE le rapport avant de conclure. Sans cette phrase, il
 * annonce à Chris qu'une équipe a réussi sur la seule foi de sa fin de tour —
 * exactement le mode de panne « narratif au lieu de mesuré » déjà payé ici.
 */
export function redigerFinEquipe(mission: Mission, maintenant: number = Date.now()): TexteNotification {
  const nom = mission.nom || mission.id;
  const detail = `${mission.projet} · ${cout(mission.budgetConsommeUsd)} · ${duree(mission.demarreeA, maintenant)}`;
  return {
    titre: `Équipe terminée — ${nom}`,
    corps: detail,
    pourOrchestrateur:
      `[HARNESS] L'équipe « ${nom} » (${mission.projet}) vient de rendre sa réponse. ` +
      `Identifiant : ${mission.id}. Coût ${cout(mission.budgetConsommeUsd)}, ` +
      `durée ${duree(mission.demarreeA, maintenant)}.\n\n` +
      "Ce message vient du harness, pas de Chris : il ne t'a rien demandé, c'est un fait du parc.\n\n" +
      `Lis son rapport avec rapport_equipe("${mission.id}") AVANT de conclure quoi que ce soit — ` +
      "« terminée » signifie que le lead a fini de parler, pas que l'objectif est atteint. " +
      'Puis décide : le mandat est-il rempli, faut-il une équipe de suite, ou une vérification ? ' +
      "Si tu proposes un nouveau mandat, dis-le à Chris ; s'il n'y a rien à faire, une ligne suffit.\n\n" +
      // `☠` SANS CE PARAGRAPHE, l'orchestrateur n'a aucun moyen de savoir qu'il
      // vient d'hériter d'un verrou. Il lisait le rapport, répondait « bien
      // reçu », et le projet restait occupé — dispatch suivant refusé par H-56
      // sur un parc qui n'affiche pourtant aucune équipe active (mesuré le 01/08).
      `ATTENTION — cette équipe OCCUPE ENCORE « ${mission.projet} » : tant qu'elle est ouverte, ` +
      'aucune autre équipe ne peut démarrer sur ce projet (H-56). Deux gestes possibles, ' +
      "choisis-en un maintenant : lui réinjecter du travail avec envoyer_message_equipe " +
      `si son mandat mérite d'être prolongé, ou la fermer avec arreter_equipe("${mission.id}") ` +
      'pour libérer le projet. Ne rien faire la laisse au repos — le harness finira par la ' +
      'clore seul, mais après un délai qui bloque tout dispatch entre-temps.',
  };
}

/** Une équipe s'est arrêtée sans rendre de réponse exploitable. */
export function redigerEchecEquipe(mission: Mission, raison: string): TexteNotification {
  const nom = mission.nom || mission.id;
  return {
    titre: `Équipe en échec — ${nom}`,
    corps: `${mission.projet} · ${raison}`,
    pourOrchestrateur:
      `[HARNESS] L'équipe « ${nom} » (${mission.projet}) s'est arrêtée sans terminer. ` +
      `Identifiant : ${mission.id}. Raison enregistrée : ${raison}.\n\n` +
      "Ce message vient du harness, pas de Chris.\n\n" +
      `Vérifie son état avec etat_equipe("${mission.id}") et son dernier texte avec ` +
      `rapport_equipe("${mission.id}"). Une relance (relancer_equipe) préserve le contexte et ` +
      "convient à un crash ; un échec de fond mérite plutôt un nouveau mandat mieux cadré. " +
      'Tranche, et dis à Chris ce que tu as retenu.',
  };
}

export function redigerPour(
  type: TypeNotification,
  mission: Mission,
  raison: string | null,
  maintenant: number = Date.now(),
): TexteNotification {
  if (type === 'equipe_echouee') return redigerEchecEquipe(mission, raison ?? 'inconnue');
  return redigerFinEquipe(mission, maintenant);
}
