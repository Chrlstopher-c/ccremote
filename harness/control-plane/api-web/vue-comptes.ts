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

import type { Compte, PreferenceCompte, Quota } from '../registre/index.ts';

export interface FenetreApi {
  readonly util: number;
  /** Délai relatif : « 3 h 30 », « 12 min », « expirée ». */
  readonly resetLabel: string;
  /**
   * Heure exacte du reset — « 10:30 PM », ou « lundi 28 juil. · 08:00 AM » pour
   * la fenêtre hebdomadaire. `null` quand aucun reset n'est connu ou déjà passé.
   */
  readonly resetAt: string | null;
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
  /** `true` sur le compte que l'opérateur a choisi à la main, s'il y en a un. */
  readonly selected: boolean;
  /**
   * `true` quand ce choix est verrouillé : aucune rotation automatique, même
   * sur saturation. `☠` Porté par le compte et non par l'enveloppe pour que
   * l'écran puisse dire « verrouillé » LÀ où il montre le compte concerné —
   * un cadenas global n'aurait pas nommé sa cible.
   */
  readonly locked: boolean;
}

const FENETRE_INCONNUE: FenetreApi = { util: 0, resetLabel: '—', resetAt: null };

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

/** Fuseau de l'opérateur — un reset lu en UTC désignerait la mauvaise heure. */
const FUSEAU = 'Europe/Paris';

/** `10:30 PM`. Format 12 h demandé par l'opérateur (23/07). */
function heureAmPm(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: FUSEAU,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Heure exacte du reset. `☠` Complète le délai relatif, ne le remplace pas :
 * « dans 3 h 30 » dit s'il faut attendre, « 10:30 PM » dit s'il faut aller
 * dormir. Les deux servent, à des moments différents.
 *
 * La fenêtre 5 h tombe presque toujours le jour même : l'heure seule suffit. La
 * fenêtre 7 j tombe des jours plus tard — sans le jour, « 08:00 AM » ne dit rien
 * d'utilisable (demandé par l'opérateur, 23/07).
 */
function libelleHeureReset(resetMs: number | null, maintenantMs: number, avecJour: boolean): string | null {
  if (resetMs === null || resetMs <= maintenantMs) return null;
  const date = new Date(resetMs);
  if (!avecJour) return heureAmPm(date);
  const jour = date.toLocaleDateString('fr-FR', { timeZone: FUSEAU, weekday: 'long', day: 'numeric', month: 'short' });
  return `${jour} · ${heureAmPm(date)}`;
}

function versFenetre(quota: Quota | undefined, maintenantMs: number, avecJour = false): FenetreApi {
  if (quota === undefined) return FENETRE_INCONNUE;
  return {
    util: quota.utilisation ?? 0,
    resetLabel: libelleReset(quota.resetA, maintenantMs),
    resetAt: libelleHeureReset(quota.resetA, maintenantMs, avecJour),
  };
}

export function versAccountApi(
  compte: Compte,
  quotas: readonly Quota[],
  maintenantMs: number,
  preference: PreferenceCompte = { compteId: null, verrouille: false, majA: 0 },
): AccountApi {
  const choisi = preference.compteId === compte.id;
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
    // Le jour compte pour la fenêtre hebdomadaire : elle retombe plusieurs jours plus tard.
    seven_day: versFenetre(septJours, maintenantMs, true),
    selected: choisi,
    locked: choisi && preference.verrouille,
  };
}
