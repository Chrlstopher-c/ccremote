// Responsabilité : le contrat des modules (dossier `<id>/` avec module.json) et les messages poste → relais qui les
// transportent. Les limites et la forme sont celles de recherche/MODULES.md ; le poste valide, le relais fait confiance
// à ce qu'il reçoit après zod.
import { z } from 'zod';

export const TAILLE_MAX_MODULE = 2 * 1024 * 1024; // octets, tous fichiers réunis
export const FICHIERS_MAX_MODULE = 200;
export const EMPLACEMENTS_MODULE = ['panneau', 'reglages', 'saisie', 'commande'] as const;
export const REGEX_ID_MODULE = /^[a-z0-9-]{2,40}$/;

export const IdModule = z.string().regex(REGEX_ID_MODULE);

export const ManifesteModule = z.object({
  id: IdModule,
  nom: z.string().min(1).max(80),
  version: z.string().min(1).max(40),
  description: z.string().max(400),
  icone: z.string().min(1).max(60),
  point: z.string().min(1).max(200),
  emplacements: z.array(z.enum(EMPLACEMENTS_MODULE)),
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
