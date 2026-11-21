// Responsabilité : le contrat des modules (dossier `<id>/` avec module.json) et les messages poste → relais qui les
// transportent. Les limites et la forme sont celles de recherche/MODULES.md ; le poste valide, le relais fait confiance
// à ce qu'il reçoit après zod.
import { z } from 'zod';

export const TAILLE_MAX_MODULE = 2 * 1024 * 1024; // octets, tous fichiers réunis
export const FICHIERS_MAX_MODULE = 200;
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
] as const;

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
