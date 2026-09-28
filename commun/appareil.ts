// Responsabilité : le vocabulaire de l'accès à un appareil du parc — ses fichiers et ses terminaux.
// Partagé par le poste (qui agit), le relais (qui transmet) et les clients (qui affichent).
import { z } from 'zod';

/** Un morceau de fichier voyage en base64 sur le lien du poste : 4 Mo bruts, ~5,4 Mo encodés. */
export const TAILLE_MORCEAU = 4 * 1024 * 1024;
/** Au-delà, un fichier se télécharge quand même (par morceaux) mais ne s'ouvre pas dans l'éditeur. */
export const TAILLE_MAX_EDITION = 2 * 1024 * 1024;

const Chemin = z.string().min(1).max(4096);

export const EntreeFichier = z.object({
  nom: z.string(),
  type: z.enum(['dossier', 'fichier', 'lien', 'autre']),
  taille: z.number(),
  modifie: z.string(),
  cache: z.boolean(),
});
export type EntreeFichier = z.infer<typeof EntreeFichier>;

export const ListeDossier = z.object({
  chemin: z.string(),
  parent: z.string().nullable(),
  accueil: z.string(),
  entrees: z.array(EntreeFichier),
});
export type ListeDossier = z.infer<typeof ListeDossier>;

export const MorceauFichier = z.object({ taille: z.number(), base64: z.string() });
export type MorceauFichier = z.infer<typeof MorceauFichier>;

export const CibleTerminal = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shell'), dossier: Chemin.optional() }),
  z.object({ type: z.literal('tmux'), tmux: z.string().regex(/^[\w.-]+$/) }),
]);
export type CibleTerminal = z.infer<typeof CibleTerminal>;

const avecId = { id: z.string() };
const Terminal = z.string().uuid();
const Dimension = z.number().int().min(2).max(1000);

/** Les commandes « appareil » du relais vers un poste. */
export const commandesAppareil = [
  z.object({ kind: z.literal('fichiers_lister'), ...avecId, chemin: Chemin.optional() }),
  z.object({
    kind: z.literal('fichier_lire'),
    ...avecId,
    chemin: Chemin,
    debut: z.number().int().min(0),
    longueur: z.number().int().min(1).max(TAILLE_MORCEAU),
  }),
  z.object({
    kind: z.literal('fichier_ecrire'),
    ...avecId,
    chemin: Chemin,
    base64: z.string().max(Math.ceil((TAILLE_MORCEAU * 4) / 3) + 8),
    ajout: z.boolean(),
  }),
  z.object({ kind: z.literal('fichier_supprimer'), ...avecId, chemin: Chemin }),
  z.object({ kind: z.literal('fichier_renommer'), ...avecId, de: Chemin, vers: Chemin }),
  z.object({ kind: z.literal('dossier_creer'), ...avecId, chemin: Chemin }),
  z.object({
    kind: z.literal('terminal_ouvrir'),
    ...avecId,
    terminal: Terminal,
    cible: CibleTerminal,
    colonnes: Dimension,
    lignes: Dimension,
  }),
  // Sans réponse : la frappe et le redimensionnement vont vite et ne s'accusent pas.
  z.object({
    kind: z.literal('terminal_entree'),
    id: z.string(),
    terminal: Terminal,
    base64: z.string().max(1_000_000),
  }),
  z.object({
    kind: z.literal('terminal_taille'),
    id: z.string(),
    terminal: Terminal,
    colonnes: Dimension,
    lignes: Dimension,
  }),
  z.object({ kind: z.literal('terminal_fermer'), id: z.string(), terminal: Terminal }),
] as const;

export const SANS_REPONSE = new Set(['terminal_entree', 'terminal_taille', 'terminal_fermer']);

/** Les comptes rendus « appareil » d'un poste vers le relais. */
export const messagesAppareil = [
  z.object({ kind: z.literal('terminal_sortie'), terminal: Terminal, base64: z.string() }),
  z.object({ kind: z.literal('terminal_fin'), terminal: Terminal, code: z.number().nullable() }),
] as const;

/** Du client vers le relais, sur le WebSocket d'un terminal (texte JSON ; la frappe brute part en binaire). */
export const MessageClientTerminal = z.object({ type: z.literal('taille'), colonnes: Dimension, lignes: Dimension });
