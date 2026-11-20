// Responsabilité : traduire les blocs de facturation et d'identité de l'API Anthropic (profil, crédits d'utilisation,
// dépenses, crédits prépayés, répartition de la semaine, parts par modèle) vers la vue commune. Pur, sans I/O.
import type {
  CreditsPrepayes,
  Depenses,
  Montant,
  PartModele,
  ProfilCompte,
  RepartitionSemaine,
  UsageSupplementaire,
} from '../../commun/compte-detail.ts';
import { booleen, estObjet, nombre, objet, objetOuNull, tableau, texte } from './valeurs.ts';

type LigneRepartition = RepartitionSemaine['lignes'][number];
type TranchePromo = CreditsPrepayes['tranchesPromo'][number];

export function lireProfil(v: unknown): ProfilCompte | null {
  if (!estObjet(v)) return null;
  const compte = objet(v['account']);
  const org = objet(v['organization']);
  return {
    nom: texte(compte['display_name']) ?? texte(compte['full_name']),
    email: texte(compte['email']),
    compteCreeLe: texte(compte['created_at']),
    max: booleen(compte['has_claude_max']),
    pro: booleen(compte['has_claude_pro']),
    organisation: texte(org['name']),
    typeOrganisation: texte(org['organization_type']),
    facturation: texte(org['billing_type']),
    niveauLimites: texte(org['rate_limit_tier']),
    niveauSiege: texte(org['seat_tier']),
    statutAbonnement: texte(org['subscription_status']),
    abonnementDepuis: texte(org['subscription_created_at']),
    usageSupplementaireActive: booleen(org['has_extra_usage_enabled']),
    essaiClaudeCodeFin: texte(org['claude_code_trial_ends_at']),
    application: texte(objet(v['application'])['name']),
  };
}

/** Montant Anthropic `{ amount_minor, currency, exponent }` vers la forme commune (unités mineures). */
export function montant(v: unknown): Montant | null {
  const m = objetOuNull(v);
  if (!m) return null;
  const mineur = nombre(m['amount_minor']);
  const devise = texte(m['currency']);
  const exposant = nombre(m['exponent']);
  return mineur === null || devise === null || exposant === null ? null : { mineur, devise, exposant };
}

export function lireUsageSupplementaire(v: unknown): UsageSupplementaire | null {
  const x = objetOuNull(v);
  if (!x) return null;
  return {
    active: booleen(x['is_enabled']) ?? false,
    plafondMensuel: nombre(x['monthly_limit']),
    consomme: nombre(x['used_credits']),
    pourcent: nombre(x['utilization']),
    devise: texte(x['currency']),
    decimales: nombre(x['decimal_places']),
    raisonDesactivation: texte(x['disabled_reason']),
    desactiveParUtilisateur: booleen(x['user_disabled']),
    plafondAtteint: booleen(x['spend_limit_reached']),
    dejaActive: booleen(x['credits_ever_enabled']),
    jour: x['daily'] ?? null,
    semaine: x['weekly'] ?? null,
  };
}

export function lireDepenses(v: unknown): Depenses | null {
  const x = objetOuNull(v);
  if (!x) return null;
  return {
    consomme: montant(x['used']),
    plafond: montant(x['limit']),
    pourcent: nombre(x['percent']),
    gravite: texte(x['severity']),
    active: booleen(x['enabled']),
    raisonDesactivation: texte(x['disabled_reason']),
    solde: montant(x['balance']),
    mention: texte(x['disclaimer']),
    peutAcheter: booleen(x['can_purchase_credits']),
    peutBasculer: booleen(x['can_toggle']),
  };
}

function tranchePromo(v: unknown): TranchePromo[] {
  if (!estObjet(v)) return [];
  return [
    {
      reste: nombre(v['remaining_amount_minor_units']),
      accorde: nombre(v['granted_amount_minor_units']),
      devise: texte(v['currency']),
      expireLe: texte(v['expires_at']),
      accordeLe: texte(v['granted_at']),
      nom: texte(v['name']),
    },
  ];
}

// Forme non documentée quand le rechargement est actif : un objet, actif sauf `enabled` explicitement faux.
function rechargeAuto(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return estObjet(v) ? (booleen(v['enabled']) ?? true) : null;
}

export function lireCredits(v: unknown): CreditsPrepayes | null {
  const x = objetOuNull(v);
  if (!x) return null;
  const politique = objet(x['credit_expiry_policy']);
  return {
    solde: montant(objet(x['balance'])['money']),
    tranchesPromo: tableau(x['promo_tranches']).flatMap(tranchePromo),
    prochaineExpiration: texte(x['next_expires_at']),
    expirationMois: nombre(politique['months']),
    expirationDepuis: texte(politique['effective_date']),
    rechargeAuto: rechargeAuto(x['auto_reload_settings']),
    factureEnAttente: nombre(x['pending_invoice_amount_cents']),
  };
}

function ligneRepartition(v: unknown): LigneRepartition[] {
  if (!estObjet(v)) return [];
  const cle = texte(v['key']);
  const pourcent = nombre(v['percent']);
  if (cle === null || pourcent === null) return [];
  return [{ cle, libelle: texte(v['display_name']) ?? cle, pourcent, pourcentLimite: nombre(v['percent_of_limit']) }];
}

export function lireRepartition(v: unknown): RepartitionSemaine | null {
  const x = objetOuNull(v);
  if (!x) return null;
  return {
    calculeLe: texte(x['as_of']),
    debutFenetre: texte(x['window_started_at']),
    lignes: tableau(x['rows']).flatMap(ligneRepartition),
  };
}

function partModele(v: unknown): PartModele[] {
  if (!estObjet(v)) return [];
  const indexLimite = nombre(v['limit_index']);
  if (indexLimite === null) return [];
  return [
    {
      indexLimite,
      pourcentSemaine: nombre(v['used_percent_of_weekly']),
      allocationPourcent: nombre(v['allowance_percent_of_weekly']),
    },
  ];
}

export function lireParts(v: unknown): PartModele[] {
  return tableau(v).flatMap(partModele);
}
