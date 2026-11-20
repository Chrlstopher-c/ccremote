// Responsabilité : traduire le bloc `cedar_ember` de l'usage (offres de réinitialisation de limite du programme
// cedar_ember) vers la vue commune. Pur, sans I/O. Une offre sans identifiant est écartée.
import type { OffreReinitialisation, Reinitialisations } from '../../commun/compte-detail.ts';
import { booleen, estObjet, nombre, objet, objetOuNull, tableau, texte, textes } from './valeurs.ts';

function pourcentsUtilises(v: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(objet(v)).flatMap(([cle, n]): [string, number][] =>
      typeof n === 'number' && Number.isFinite(n) ? [[cle, n]] : [],
    ),
  );
}

function offre(v: unknown): OffreReinitialisation[] {
  if (!estObjet(v)) return [];
  const id = texte(v['id']);
  if (id === null) return [];
  return [
    {
      id,
      libelle: texte(v['label']) ?? id,
      total: nombre(v['resets_total']) ?? 0,
      restantes: nombre(v['resets_left']) ?? 0,
      debut: texte(v['starts_at']),
      fin: texte(v['ends_at']),
      efface: textes(v['clears']),
      enPause: booleen(v['paused']) ?? false,
      utilisableMaintenant: booleen(v['usable_now']) ?? false,
      exigeLimite: booleen(v['use_requires_limit']) ?? false,
      type: texte(v['type']),
      rendSemaine: booleen(v['gives_back_weekly']) ?? false,
      raisonIndisponible: texte(v['unavailable_reason']),
      pourcentsUtilises: pourcentsUtilises(v['percent_used']),
      bloquants: textes(v['blocking']),
    },
  ];
}

/** `disponibles` : les restantes des offres utilisables maintenant et non suspendues. */
function disponibles(offres: readonly OffreReinitialisation[]): number {
  return offres.filter((o) => o.utilisableMaintenant && !o.enPause).reduce((somme, o) => somme + o.restantes, 0);
}

export function lireReinitialisations(v: unknown): Reinitialisations | null {
  const x = objetOuNull(v);
  if (!x) return null;
  const evenement = objet(x['event_props']);
  const offres = tableau(x['grants']).flatMap(offre);
  return {
    eligible: booleen(x['eligible']) ?? false,
    raisonIneligible: texte(x['ineligible_reason']),
    aLaLimite: booleen(x['at_limit']) ?? false,
    epuisees: textes(x['exhausted']),
    prochaine: texte(x['next_grant_id']),
    semaineRemiseLe: texte(x['weekly_resets_at']),
    attenteJusquA: texte(x['cooldown_until']),
    etatUsageSupplementaire: texte(evenement['extra_usage_state']),
    niveau: texte(evenement['tier']),
    anciennete: texte(evenement['tenure_bucket']),
    paiement: texte(evenement['billing_path']),
    periode: texte(evenement['billing_period']),
    disponibles: disponibles(offres),
    offres,
  };
}
