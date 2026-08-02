/**
 * Responsabilité : groupe « budget » de la surface d'outils (A.2.2) — mutatif.
 *
 * `☠` Ce fichier s'appelait `outils-arbitrage.ts` et portait aussi
 * `repondre_permission`, retiré le 2026-07-31 avec le bus d'escalade : en
 * `permissionMode: 'auto'` le SDK n'appelle jamais `canUseTool`, donc aucune
 * demande n'a jamais atteint la machine à états — il n'y avait rien à arbitrer.
 * L'arbitrage nominal appartient au lead (H-40), et la protection réelle vit en
 * amont, dans `disallowedTools` (plancher de déni + accès du mandat).
 *
 * `arret_urgence` de A.2.2 reste délibérément ABSENT : H-57 l'interdit
 * explicitement dans l'orchestrateur — « ne passent ni l'une ni l'autre par
 * l'orchestrateur ». Voir `index.ts` pour la note de contradiction résolue.
 */

import type { Registre } from '../../registre/index.ts';
import { accepte, applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import { resoudreMission } from './outils-inspection.ts';
import { avecPlafond } from './plafond.ts';
import type { ContratRetour, DefinisseurBudget } from './types.ts';

/**
 * `definir_budget` (A.2.2, G) — plafond de dépense par mission (H-68 : filet de
 * dernier recours, pas l'anti-boucle).
 *
 * `☠ DEUX PLAFONDS, ET LEUR DIFFÉRENCE COMPTE` — celui du SDK est posé au
 * démarrage de la session (`maxBudgetUsd`) et aucune API ne le rouvre ; celui du
 * harness vit au registre et est comparé à chaque relevé de télémétrie. Cet
 * outil écrit le SECOND. Conséquence, dite au modèle plutôt que tue :
 *  - BAISSER est pleinement effectif, y compris sur une équipe déjà lancée —
 *    le harness coupe avant le SDK ;
 *  - MONTER ne repousse pas la coupure du SDK : la session en cours s'arrêtera
 *    quand même à son plafond d'origine. C'est exactement ce que l'orchestrateur
 *    a constaté le 02/08 en le qualifiant d'« inopérant sur session démarrée ».
 */
export async function definirBudget(
  definisseur: DefinisseurBudget,
  registre: Registre,
  designation: string,
  maxUsd: number,
  plafondMs?: number,
): Promise<ContratRetour> {
  const intention = `définir le budget de ${designation} à ${maxUsd} USD`;
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    return refuse(intention, 'le budget doit être un nombre fini strictement positif');
  }
  try {
    const resolution = resoudreMission(registre, designation);
    if ('absent' in resolution) return refuse(intention, 'aucune équipe ne correspond à cette désignation');
    if ('ambigu' in resolution) {
      const noms = resolution.ambigu.map((m) => `${m.nom} (${m.id})`).join(', ');
      return refuse(intention, `désignation ambiguë — préciser l'identifiant parmi : ${noms}`);
    }
    const mission = resolution.trouve;
    const ancien = mission.budgetMaxUsd;
    const resultat = await avecPlafond(definisseur.definir(mission.id, maxUsd), plafondMs);
    if (resultat.etat === 'delai_depasse') {
      return accepte(intention, mission.id, 'demande transmise, confirmation non reçue à temps');
    }
    const consomme = mission.budgetConsommeUsd;
    if (ancien !== null && maxUsd > ancien) {
      return accepte(
        intention,
        mission.id,
        `plafond du harness porté à ${maxUsd} $ (consommé : ${consomme.toFixed(2)} $). ` +
          `ATTENTION : la session en cours garde le plafond posé à son démarrage (${ancien} $) — ` +
          'le SDK la coupera là, quoi qu\'il arrive. Pour dépenser au-delà, il faut une nouvelle équipe.',
      );
    }
    return applique(
      intention,
      `plafond ramené à ${maxUsd} $ (consommé : ${consomme.toFixed(2)} $) — le harness coupe l'équipe au dépassement`,
      mission.id,
    );
  } catch (erreur) {
    journal.error({ err: erreur, designation, maxUsd }, 'definirBudget en échec');
    return echecInattendu(intention, erreur);
  }
}
