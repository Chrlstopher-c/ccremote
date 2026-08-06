/**
 * Responsabilité : groupe « machine » de la surface d'outils (A.2.2) — l'orchestrateur
 * agit sur le PC lui-même, pas sur une équipe : `etat_machine` (lecture pure) et
 * `reveiller_machine` (Wake-on-LAN).
 *
 * `☠` Ces deux outils ne pilotent QUE le PC — jamais le Raspberry Pi qui héberge ce
 * serveur MCP. `machine` est un `z.enum(['pc'])` fermé côté serveur.ts, pas une chaîne
 * libre : c'est ce qui empêche structurellement un modèle de désigner une autre cible,
 * ou de faire fournir un MAC arbitraire à `reveiller_machine` (voir `reveil-wol.ts`).
 *
 * `☠` `etat_service`, `piloter_service` et `eteindre_machine` sont DÉLIBÉRÉMENT
 * ABSENTS de ce fichier : les deux premiers exigent une liste blanche de services
 * que seul l'opérateur détient, le troisième est écarté par analogie avec H-57
 * (`arret_urgence` hors de l'orchestrateur — voir `serveur.ts`).
 */

import { accepte, applique, echecInattendu } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour, LecteurMetriquesHote } from './types.ts';
import type { MetriquesHote } from '../../../superviseur/metriques-hote.ts';

/** Seule valeur acceptée aujourd'hui — voir l'en-tête de fichier. */
export type MachinePilotable = 'pc';

/** Port de réveil — implémenté côté composition par `reveil-wol.ts` (hors canal D.3). */
export interface EmetteurReveil {
  reveiller(): Promise<void>;
}

/** Un chiffre absent se dit `?`, jamais 0 — un 0 se lirait comme une mesure réelle. */
function n(valeur: number | null): string {
  return valeur === null ? '?' : String(valeur);
}

/** Résume un relevé de métriques en une ligne lisible, même style que `etatEquipe`. */
function resumerMetriques(m: MetriquesHote): string {
  const heures = Math.floor(m.uptimeS / 3600);
  const gpu =
    m.gpu === null
      ? 'gpu=absent'
      : `gpu=${n(m.gpu.utilPct)}% (${n(m.gpu.memUtiliseeMo)}/${n(m.gpu.memTotaleMo)} Mo, ${n(m.gpu.tempC)}°C)`;
  return [
    `machine=${m.machine}`,
    `cpu=${n(m.cpuPct)}%`,
    `temp=${n(m.tempCpuC)}°C`,
    `mem=${n(m.memUtiliseeMo)}/${n(m.memTotaleMo)} Mo (${n(m.memPct)}%)`,
    `disque=${n(m.disqueUtiliseGo)}/${n(m.disqueTotalGo)} Go`,
    `reseau=↑${n(m.reseauMontantKo)} Ko/s ↓${n(m.reseauDescendantKo)} Ko/s`,
    gpu,
    `uptime=${heures}h`,
  ].join(' · ');
}

/**
 * `etat_machine` (A.2.2) — lecture pure des métriques matérielles du PC.
 *
 * `☠` Ne relève RIEN lui-même : délègue à `metriques_hote`, déjà câblé de bout en
 * bout (canal D.3, `superviseur/metriques-hote.ts`) et déjà consommé par l'API
 * web. Ce module ne fait que traduire le relevé existant en contrat MCP — un
 * second relevé indépendant divergerait tôt ou tard du premier.
 */
export async function etatMachine(lecteur: LecteurMetriquesHote, machine: MachinePilotable): Promise<ContratRetour> {
  const intention = `état de la machine ${machine}`;
  try {
    const metriques = await lecteur.metriquesHote();
    if (metriques === null) {
      return { ok: false, intention, effet: 'refuse', raison: `machine « ${machine} » injoignable ou métriques indisponibles` };
    }
    return applique(intention, resumerMetriques(metriques));
  } catch (erreur) {
    journal.error({ err: erreur, machine }, 'etat_machine en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `reveiller_machine` (A.2.2) — Wake-on-LAN, HORS canal D.3 (voir `reveil-wol.ts`
 * pour la raison : le PC éteint n'a aucun lien à emprunter, H-75).
 *
 * `☠` Rend `accepte`, JAMAIS `applique` : un magic packet émis ne garantit pas un
 * allumage (BIOS, câble…), et ce module n'a aucun moyen de le vérifier depuis le
 * Pi. Dire « fait » sur un effet qu'on ne peut pas observer serait exactement la
 * confusion qu'A.2.3 interdit.
 */
export async function reveillerMachine(emetteur: EmetteurReveil, machine: MachinePilotable): Promise<ContratRetour> {
  const intention = `réveil de la machine ${machine}`;
  try {
    await emetteur.reveiller();
    return accepte(intention, machine, 'magic packet émis en broadcast local — allumage non confirmable depuis le Pi');
  } catch (erreur) {
    journal.error({ err: erreur, machine }, 'reveiller_machine en échec');
    return echecInattendu(intention, erreur);
  }
}
