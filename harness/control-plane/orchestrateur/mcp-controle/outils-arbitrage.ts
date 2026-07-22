/**
 * Responsabilité : groupe « arbitrage » de la surface d'outils (A.2.2).
 *
 * `repondre_permission` ne sert QUE la voie d'escalade (H-47) : l'arbitrage
 * nominal appartient au lead (`permissionMode: 'auto'`, H-40). Un verdict rendu
 * ici est tracé comme décision humaine par procuration, jamais comme décision
 * d'agent — cette fonction ne fait que relayer le verdict déjà pris par
 * l'humain (ou son proxy autorisé), elle n'arbitre rien elle-même.
 *
 * `arret_urgence` de A.2.2 (04-arbre-A) est délibérément ABSENT de ce fichier :
 * H-57 (16-decisions-operateur.md, FAIT AUTORITÉ) l'interdit explicitement dans
 * l'orchestrateur — « ne passent ni l'une ni l'autre par l'orchestrateur ». Voir
 * `index.ts` pour la note de contradiction résolue.
 */

import { accepte, applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import { avecPlafond } from './plafond.ts';
import type { ArbitreEscalade, ContratRetour, DefinisseurBudget } from './types.ts';
import type { Verdict } from '../../bus-permissions/index.ts';

/**
 * `repondre_permission` (A.2.2, H-47) — voie d'escalade uniquement. Synchrone côté
 * bus (`MachineEtatsDemandes.repondre` ne fait aucune I/O) : pas de plafond ici,
 * la seule source de latence possible est en amont, côté humain.
 */
export function repondrePermission(arbitre: ArbitreEscalade, requestId: string, verdict: Verdict): ContratRetour {
  const intention = `répondre à la demande ${requestId}`;
  try {
    const verdictAccepte = arbitre.repondre(requestId, verdict);
    if (!verdictAccepte) {
      return refuse(intention, "la demande n'est pas (ou plus) en attente d'un verdict — déjà répondue, caduque, ou inconnue");
    }
    return applique(intention, `verdict « ${verdict.behavior} » enregistré, tracé comme décision humaine par procuration (H-47)`);
  } catch (erreur) {
    journal.error({ err: erreur, requestId }, 'repondrePermission en échec');
    return echecInattendu(intention, erreur);
  }
}

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
