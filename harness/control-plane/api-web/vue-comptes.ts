/**
 * Responsabilité : traduire comptes et quotas du registre vers la forme
 * d'affichage du contrat (jauges 5 h / 7 j, H-63/H-70).
 *
 * `☠ RAISONNER EN POURCENTAGE, JAMAIS EN DOLLARS` (H-70, mesuré) : sur
 * abonnement, les champs `*_dollars` de l'API d'usage sont `null`. Une jauge
 * bâtie dessus afficherait 0 en permanence et laisserait saturer le quota sans
 * prévenir. `utilisation` (0-100) est la seule grandeur fiable.
 *
 * `☠` `statut: 'rejected'` NE COUPE PAS la session (H-63.1, mesuré) : elle
 * continue en `extra_usage` payant. Afficher « rejeté » comme un arrêt serait
 * doublement faux — la mission tourne encore, et elle coûte désormais de
 * l'argent réel. D'où `isUsingOverage`, distinct du statut.
 */

import type { Compte, Quota } from '../registre/index.ts';

export interface FenetreApi {
  readonly util: number;
  readonly resetLabel: string;
}

export interface AccountApi {
  readonly id: string;
  readonly label: string;
  readonly email: string;
  readonly status: string;
  readonly isUsingOverage: boolean;
  readonly plan: string;
  readonly five_hour: FenetreApi;
  readonly seven_day: FenetreApi;
}

const FENETRE_INCONNUE: FenetreApi = { util: 0, resetLabel: '—' };

/**
 * `☠` UNITÉ DE LA COLONNE `reset_a` : MILLISECONDES epoch. Une seule convention,
 * fixée à l'écriture (`sonde-quotas.ts` normalise ISO ou secondes vers des ms).
 *
 * Cette fonction attendait des SECONDES pendant que la sonde écrivait des
 * millisecondes : l'écran a affiché « reset dans 495278229 h » (constaté le
 * 23/07). Deux unités dans une même colonne ne se rattrapent pas à la lecture —
 * la normalisation appartient au point d'écriture, ici on fait confiance.
 */
function libelleReset(resetMs: number | null, maintenantMs: number): string {
  if (resetMs === null) return '—';
  const restantMs = resetMs - maintenantMs;
  if (restantMs <= 0) return 'expirée';
  const minutes = Math.round(restantMs / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function versFenetre(quota: Quota | undefined, maintenantMs: number): FenetreApi {
  if (quota === undefined) return FENETRE_INCONNUE;
  return {
    util: quota.utilisation ?? 0,
    resetLabel: libelleReset(quota.resetA, maintenantMs),
  };
}

export function versAccountApi(compte: Compte, quotas: readonly Quota[], maintenantMs: number): AccountApi {
  const cinqHeures = quotas.find((q) => q.typeFenetre === 'five_hour');
  const septJours = quotas.find((q) => q.typeFenetre === 'seven_day');
  return {
    id: compte.id,
    label: compte.organisation ?? compte.id,
    email: compte.email ?? '',
    // `☠` MESURÉ, jamais supposé : l'interface affichait « Max » en dur sur des
    // comptes réellement « Claude Pro » (23/07). Vide tant qu'aucune sonde n'a
    // répondu — un champ vide est honnête, une valeur inventée ne l'est pas.
    plan: compte.typeAbonnement ?? '',
    // Le statut affiché est celui de la fenêtre 5 h : c'est elle qui décide de
    // la capacité à lancer une mission maintenant.
    status: cinqHeures?.statut ?? 'allowed',
    isUsingOverage: cinqHeures?.utiliseOverage ?? false,
    five_hour: versFenetre(cinqHeures, maintenantMs),
    seven_day: versFenetre(septJours, maintenantMs),
  };
}
