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
  readonly five_hour: FenetreApi;
  readonly seven_day: FenetreApi;
}

const FENETRE_INCONNUE: FenetreApi = { util: 0, resetLabel: '—' };

/**
 * `☠` `resetA` est en SECONDES Unix (H-63.1, relevé verbatim sur un vrai
 * `rate_limit_event`), pas en millisecondes. Multiplier par 1000 est
 * obligatoire — l'oubli produit une date en 1970, donc une fenêtre qui paraît
 * éternellement expirée.
 */
function libelleReset(resetSecondes: number | null, maintenantMs: number): string {
  if (resetSecondes === null) return '—';
  const restantMs = resetSecondes * 1000 - maintenantMs;
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
    // Le statut affiché est celui de la fenêtre 5 h : c'est elle qui décide de
    // la capacité à lancer une mission maintenant.
    status: cinqHeures?.statut ?? 'allowed',
    isUsingOverage: cinqHeures?.utiliseOverage ?? false,
    five_hour: versFenetre(cinqHeures, maintenantMs),
    seven_day: versFenetre(septJours, maintenantMs),
  };
}
