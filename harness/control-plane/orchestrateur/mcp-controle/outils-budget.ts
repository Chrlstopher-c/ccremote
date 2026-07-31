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

import { accepte, applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import { avecPlafond } from './plafond.ts';
import type { ContratRetour, DefinisseurBudget } from './types.ts';

/**
 * `definir_budget` (A.2.2, G) — plafond `maxBudgetUsd` par mission (H-68 : filet
 * de dernier recours, pas l'anti-boucle). Passe par `avecPlafond` par cohérence
 * avec les autres outils mutatifs, même si le port réel est censé rester local.
 */
export async function definirBudget(
  definisseur: DefinisseurBudget,
  missionId: string,
  maxUsd: number,
  plafondMs?: number,
): Promise<ContratRetour> {
  const intention = `définir le budget de ${missionId} à ${maxUsd} USD`;
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    return refuse(intention, 'le budget doit être un nombre fini strictement positif');
  }
  try {
    const resultat = await avecPlafond(definisseur.definir(missionId, maxUsd), plafondMs);
    if (resultat.etat === 'delai_depasse') {
      return accepte(intention, missionId, 'demande transmise, confirmation non reçue à temps');
    }
    return applique(intention, `plafond fixé à ${maxUsd} USD (filet de dernier recours, H-68)`);
  } catch (erreur) {
    journal.error({ err: erreur, missionId, maxUsd }, 'definirBudget en échec');
    return echecInattendu(intention, erreur);
  }
}
