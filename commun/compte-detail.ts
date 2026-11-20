// Responsabilité : la vue complète d'un compte Claude Code — profil, toutes les fenêtres de quota, crédits
// d'utilisation (usage facturé), crédits prépayés, réinitialisations de limite, répartition par produit, et l'usage du
// SDK (session, contributeurs). Contrat partagé par le poste (qui lit), le relais (qui relaie) et les clients.
// Montants : en unités mineures (centimes) avec leur devise. Aucun jeton, aucun identifiant interne (uuid) ici.
import { z } from 'zod';

const texte = z.string().nullable();
const nombre = z.number().nullable();

export const Montant = z.object({ mineur: z.number(), devise: z.string(), exposant: z.number() });
export type Montant = z.infer<typeof Montant>;

export const ProfilCompte = z.object({
  nom: texte, // display_name, sinon full_name
  email: texte,
  compteCreeLe: texte,
  max: z.boolean().nullable(),
  pro: z.boolean().nullable(),
  organisation: texte,
  typeOrganisation: texte, // claude_max, claude_pro, claude_team…
  facturation: texte, // billing_type : stripe_subscription…
  niveauLimites: texte, // rate_limit_tier : default_claude_max_5x…
  niveauSiege: texte,
  statutAbonnement: texte, // active…
  abonnementDepuis: texte,
  usageSupplementaireActive: z.boolean().nullable(), // has_extra_usage_enabled
  essaiClaudeCodeFin: texte,
  application: texte, // le client OAuth du jeton (Claude Code)
});
export type ProfilCompte = z.infer<typeof ProfilCompte>;

// Chaque clé de l'endpoint d'usage qui porte `utilization` (five_hour, seven_day, seven_day_opus, …, y compris les
// fenêtres inconnues aujourd'hui) : rien n'est filtré.
export const FenetreBrute = z.object({
  cle: z.string(),
  pourcent: nombre,
  reinitialiseLe: texte,
  limiteDollars: nombre,
  utiliseDollars: nombre,
  resteDollars: nombre,
  raisonBlocage: texte, // locked_reason
});
export type FenetreBrute = z.infer<typeof FenetreBrute>;

// Les lignes `limits[]` du serveur, dans son ordre : ce que Desktop affiche.
export const LigneLimite = z.object({
  genre: z.string(), // session, weekly_all, weekly_scoped…
  groupe: z.string(), // session, weekly…
  pourcent: z.number(),
  gravite: z.string(), // normal, warning, critical
  reinitialiseLe: texte,
  modele: texte, // scope.model.display_name (« Fable »)
  surface: texte, // scope.surface.display_name
  active: z.boolean(), // is_active : la ligne qu'un indicateur unique montre
});
export type LigneLimite = z.infer<typeof LigneLimite>;

// `extra_usage` : l'usage facturé au-delà du forfait (« crédits d'utilisation »).
export const UsageSupplementaire = z.object({
  active: z.boolean(),
  plafondMensuel: nombre, // unités mineures
  consomme: nombre, // unités mineures
  pourcent: nombre,
  devise: texte,
  decimales: nombre,
  raisonDesactivation: texte,
  desactiveParUtilisateur: z.boolean().nullable(),
  plafondAtteint: z.boolean().nullable(),
  dejaActive: z.boolean().nullable(), // credits_ever_enabled
  jour: z.unknown(),
  semaine: z.unknown(),
});
export type UsageSupplementaire = z.infer<typeof UsageSupplementaire>;

// `spend` : la dépense du mois en crédits, telle que l'endpoint la résume.
export const Depenses = z.object({
  consomme: Montant.nullable(),
  plafond: Montant.nullable(),
  pourcent: nombre,
  gravite: texte,
  active: z.boolean().nullable(),
  raisonDesactivation: texte,
  solde: Montant.nullable(),
  mention: texte, // disclaimer (Markdown court)
  peutAcheter: z.boolean().nullable(),
  peutBasculer: z.boolean().nullable(), // can_toggle
});
export type Depenses = z.infer<typeof Depenses>;

export const TranchePromo = z.object({
  reste: nombre, // unités mineures
  accorde: nombre,
  devise: texte,
  expireLe: texte,
  accordeLe: texte,
  nom: texte,
});

export const CreditsPrepayes = z.object({
  solde: Montant.nullable(),
  tranchesPromo: z.array(TranchePromo),
  prochaineExpiration: texte,
  expirationMois: nombre, // credit_expiry_policy.months
  expirationDepuis: texte, // credit_expiry_policy.effective_date
  rechargeAuto: z.boolean().nullable(),
  factureEnAttente: nombre, // pending_invoice_amount_cents
});
export type CreditsPrepayes = z.infer<typeof CreditsPrepayes>;

// `seven_day_breakdown` : la semaine par produit (Claude Code, Chats, Cowork…).
export const RepartitionSemaine = z.object({
  calculeLe: texte,
  debutFenetre: texte,
  lignes: z.array(
    z.object({ cle: z.string(), libelle: z.string(), pourcent: z.number(), pourcentLimite: nombre }),
  ),
});
export type RepartitionSemaine = z.infer<typeof RepartitionSemaine>;

// `weekly_scoped_shares` : part d'une ligne `limits[]` (par modèle) dans la semaine.
export const PartModele = z.object({
  indexLimite: z.number(),
  pourcentSemaine: nombre,
  allocationPourcent: nombre,
});
export type PartModele = z.infer<typeof PartModele>;

// Une offre de réinitialisation (grant du programme `cedar_ember`).
export const OffreReinitialisation = z.object({
  id: z.string(),
  libelle: z.string(),
  total: z.number(),
  restantes: z.number(),
  debut: texte,
  fin: texte,
  efface: z.array(z.string()), // fenêtres remises à zéro : five_hour, seven_day…
  enPause: z.boolean(),
  utilisableMaintenant: z.boolean(),
  exigeLimite: z.boolean(), // use_requires_limit : seulement une fois la limite atteinte
  type: texte, // session, weekly, full
  rendSemaine: z.boolean(), // gives_back_weekly
  raisonIndisponible: texte,
  pourcentsUtilises: z.record(z.string(), z.number()),
  bloquants: z.array(z.string()),
});
export type OffreReinitialisation = z.infer<typeof OffreReinitialisation>;

export const Reinitialisations = z.object({
  eligible: z.boolean(),
  raisonIneligible: texte,
  aLaLimite: z.boolean(),
  epuisees: z.array(z.string()), // fenêtres épuisées (exhausted)
  prochaine: texte, // id de l'offre que le serveur propose en premier
  semaineRemiseLe: texte,
  attenteJusquA: texte, // cooldown_until
  etatUsageSupplementaire: texte, // event_props.extra_usage_state
  niveau: texte, // event_props.tier
  anciennete: texte, // event_props.tenure_bucket
  paiement: texte, // event_props.billing_path
  periode: texte, // event_props.billing_period
  disponibles: z.number(), // somme des restantes des offres utilisables maintenant
  offres: z.array(OffreReinitialisation),
});
export type Reinitialisations = z.infer<typeof Reinitialisations>;

// Réponse `get_usage` du SDK, lue sur une session vivante de ce compte : la forme du SDK telle quelle
// (SDKControlGetUsageResponse), sans les rate_limits (déjà lus à la source ci-dessus).
export const UsageSdk = z.object({
  sessionId: z.string(), // session de Quart qui a répondu
  session: z.unknown(),
  abonnement: texte,
  contributeurs: z.unknown(), // behaviors : { day, week } ou null
  luLe: z.string(),
});
export type UsageSdk = z.infer<typeof UsageSdk>;

export const DetailCompte = z.object({
  compte: z.string(),
  machine: z.string(),
  releveLe: z.string(),
  probleme: texte, // pourquoi une partie n'a pas pu être lue
  profil: ProfilCompte.nullable(),
  limites: z.array(LigneLimite),
  fenetres: z.array(FenetreBrute),
  usageSupplementaire: UsageSupplementaire.nullable(),
  depenses: Depenses.nullable(),
  creditsPrepayes: CreditsPrepayes.nullable(),
  repartitionSemaine: RepartitionSemaine.nullable(),
  partsModeles: z.array(PartModele),
  reinitialisations: Reinitialisations.nullable(),
  sdk: UsageSdk.nullable(),
  autres: z.record(z.string(), z.unknown()), // toute autre clé non nulle de l'endpoint d'usage, telle quelle
});
export type DetailCompte = z.infer<typeof DetailCompte>;

// Réponse à « Utiliser une réinitialisation » (POST reset_rate_limits).
export const ResultatReinitialisation = z.object({
  resultat: z.string(), // reset, already_used, cooldown…, ou rate_limited, auth_error, error (poste/comptes/)
  raison: texte,
  restantes: nombre,
  efface: z.array(z.string()),
  semaineRemiseLe: texte,
  attenteJusquA: texte,
});
export type ResultatReinitialisation = z.infer<typeof ResultatReinitialisation>;
