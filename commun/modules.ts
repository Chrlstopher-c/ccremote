// Responsabilité : le contrat des modules (dossier `<id>/` avec module.json) et les messages poste → relais qui les
// transportent. Les limites et la forme sont celles de recherche/MODULES.md ; le poste valide, le relais fait confiance
// à ce qu'il reçoit après zod.
import { z } from 'zod';

export const TAILLE_MAX_MODULE = 20 * 1024 * 1024; // octets, tous fichiers réunis (serveur/node_modules exclu)
export const FICHIERS_MAX_MODULE = 2000;
export const EMPLACEMENTS_MODULE = ['panneau', 'reglages', 'saisie', 'commande'] as const;
export const REGEX_ID_MODULE = /^[a-z0-9-]{2,40}$/;

export const IdModule = z.string().regex(REGEX_ID_MODULE);

export const TAILLE_MAX_DONNEES_MODULE = 64 * 1024; // octets : arguments d'outil, résultat, données d'intégration
export const REGEX_NOM_OUTIL = /^[a-z_]{2,40}$/;

/** Schéma JSON (objet) des arguments d'un outil ou des données d'une intégration. */
export const SchemaModule = z.record(z.string(), z.unknown());
export const DonneesModule = z.record(z.string(), z.unknown());

export const OutilModule = z.object({
  nom: z.string().regex(REGEX_NOM_OUTIL),
  description: z.string().min(1).max(400),
  schema: SchemaModule,
});
export type OutilModule = z.infer<typeof OutilModule>;

export const IntegrationModule = z.object({
  id: IdModule,
  titre: z.string().min(1).max(80),
  description: z.string().max(400),
  schema: SchemaModule,
});
export type IntegrationModule = z.infer<typeof IntegrationModule>;

// Partie serveur (v1.2) : un serveur Bun tourne sur le poste de sa machine, hors de l'appli.
export const DOSSIER_SERVEUR = 'serveur';
export const DOSSIER_DEPENDANCES_SERVEUR = 'serveur/node_modules'; // jamais envoyé au relais
export const TAILLE_MAX_CORPS_SERVEUR = 4 * 1024 * 1024; // octets, requête comme réponse (décodés)
export const DELAI_REQUETE_SERVEUR_MS = 30_000;
export const EtatServeur = z.enum(['demarrage', 'pret', 'panne', 'arrete']);
export type EtatServeur = z.infer<typeof EtatServeur>;
export const EncodageCorps = z.enum(['texte', 'base64']);
export type EncodageCorps = z.infer<typeof EncodageCorps>;

export const ServeurModule = z.object({
  point: z
    .string()
    .min(1)
    .max(200)
    .regex(/^serveur\/.+/),
  machine: z
    .string()
    .regex(/^[a-z0-9-]{1,60}$/)
    .optional(), // par défaut : la machine qui publie le module
});
export type ServeurModule = z.infer<typeof ServeurModule>;

export const ManifesteModule = z.object({
  id: IdModule,
  nom: z.string().min(1).max(80),
  version: z.string().min(1).max(40),
  description: z.string().max(400),
  icone: z.string().min(1).max(60),
  point: z.string().min(1).max(200),
  emplacements: z.array(z.enum(EMPLACEMENTS_MODULE)),
  outils: z.array(OutilModule).max(50).optional(), // ce que les agents peuvent appeler (v1.1)
  integrations: z.array(IntegrationModule).max(50).optional(), // ce que les agents peuvent afficher dans le fil (v1.1)
  serveur: ServeurModule.optional(), // le back-end du module, lancé par le poste de sa machine (v1.2)
});
export type ManifesteModule = z.infer<typeof ManifesteModule>;

export const FichierModule = z.object({ chemin: z.string().min(1).max(500), base64: z.string() });
export type FichierModule = z.infer<typeof FichierModule>;

/** Vrai pour un chemin relatif sûr : ni absolu, ni `..`, ni segment vide, sans antislash. */
export function cheminModuleValide(chemin: string): boolean {
  if (chemin.length === 0 || chemin.startsWith('/') || chemin.includes('\\')) return false;
  return chemin.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export const messagesModules = [
  z.object({
    kind: z.literal('module'),
    id: IdModule,
    manifeste: ManifesteModule,
    fichiers: z.array(FichierModule).max(FICHIERS_MAX_MODULE),
    empreinte: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({ kind: z.literal('module_retire'), id: IdModule }),
  z.object({ kind: z.literal('module_erreur'), id: IdModule, erreur: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal('module_serveur'),
    id: IdModule,
    etat: EtatServeur,
    erreur: z.string().min(1).max(2000).optional(),
  }),
] as const;

const METHODES_SERVEUR = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** Une requête HTTP à faire au serveur d'un module : `api.serveur.fetch(chemin, { method, headers, body })`. */
export const RequeteServeur = z.object({
  chemin: z.string().min(1).max(2000).regex(/^\//),
  method: z.enum(METHODES_SERVEUR).optional(), // GET par défaut
  headers: z.record(z.string().max(200), z.string().max(8000)).optional(),
  body: z
    .string()
    .max(TAILLE_MAX_CORPS_SERVEUR * 2)
    .optional(),
  encodage: EncodageCorps.optional(), // texte par défaut
});
export type RequeteServeur = z.infer<typeof RequeteServeur>;

/** La réponse du serveur : `body` en texte, ou en base64 si le type n'est pas du texte UTF-8. */
export const ReponseServeur = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  encodage: EncodageCorps,
});
export type ReponseServeur = z.infer<typeof ReponseServeur>;

/** Vrai si le corps de la requête dépasse 4 Mo une fois décodé. */
export function depasseCorpsServeur(corps: string | undefined, encodage: EncodageCorps | undefined): boolean {
  if (corps === undefined) return false;
  const octets = encodage === 'base64' ? Buffer.from(corps, 'base64').byteLength : Buffer.byteLength(corps);
  return octets > TAILLE_MAX_CORPS_SERVEUR;
}

// Relais → poste : la requête part au serveur du module ; la réponse revient en `donnees` (ReponseServeur).
export const commandesModules = [
  z.object({ kind: z.literal('module_requete'), id: z.string(), module: IdModule, requete: RequeteServeur }),
];

// Appels d'outils (v1.1) : un agent (poste) demande au relais, le relais relaie à une appli, l'appli répond.
export const DemandeAppelModule = z.object({
  module: IdModule,
  outil: z.string().regex(REGEX_NOM_OUTIL),
  arguments: DonneesModule.optional(),
  session: z.string().min(1).max(200).nullable(),
});
export type DemandeAppelModule = z.infer<typeof DemandeAppelModule>;

// Réponse d'une appli au relais : `erreur: 'module absent'` si le module n'est pas actif chez elle.
export const ReponseAppelModule = z.object({
  appel: z.string().min(1).max(64),
  ok: z.boolean(),
  resultat: z.unknown().optional(),
  erreur: z.string().max(2000).optional(),
});
export type ReponseAppelModule = z.infer<typeof ReponseAppelModule>;

/** Vrai si la valeur, en JSON, dépasse la limite des données de module (64 Ko). */
export function depasseTailleDonnees(valeur: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(valeur) ?? '').length > TAILLE_MAX_DONNEES_MODULE;
}
