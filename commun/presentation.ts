// Responsabilité : le vocabulaire de la présentation de fichiers à Chris (envoi, artefacts, widgets, images du fil) —
// types autorisés, plafonds, identifiants des fichiers stockés sur le poste. Pur : partagé par le poste (écriture,
// lecture) et le relais (route des fichiers, pièces jointes).
import { basename, extname } from 'node:path';
import { z } from 'zod';

export const TAILLE_MAX_FICHIER = 5 * 1024 * 1024;
export const TAILLE_MAX_PIECE = 3 * 1024 * 1024;
export const NOMBRE_MAX_PIECES = 3;
export const TAILLE_MAX_WIDGET = 300 * 1024;
export const TAILLE_MAX_NOM = 200;

const CODE = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'py',
  'sh',
  'bash',
  'zsh',
  'rs',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'css',
  'scss',
  'yml',
  'yaml',
  'toml',
  'ini',
  'sql',
  'rb',
  'php',
  'xml',
  'lua',
  'conf',
] as const;

const TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  ...Object.fromEntries(CODE.map((ext) => [ext, 'text/plain'])),
};

/** Type MIME d'un fichier d'après son extension, ou null si le type n'est pas présentable. */
export function typeDeFichier(nom: string): string | null {
  const ext = extname(nom).slice(1).toLowerCase();
  return TYPES[ext] ?? null;
}

export function estImage(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Nom affiché d'un fichier : son nom seul, sans dossier, borné. */
export function nomAffiche(nom: string): string {
  const sansDossier = basename(nom)
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  return (sansDossier || 'fichier').slice(0, TAILLE_MAX_NOM);
}

// Un fichier stocké : 16 hexadécimaux, suivi de `-vN` pour une version d'artefact. Jamais de chemin dans l'identifiant.
const ID_FICHIER = /^[a-f0-9]{16}(?:-v[0-9]{1,4})?$/;
const ID_ARTEFACT = /^[a-f0-9]{16}$/;

export function estIdFichier(id: string): boolean {
  return ID_FICHIER.test(id);
}

export function estIdArtefact(id: string): boolean {
  return ID_ARTEFACT.test(id);
}

export const ModeFichier = z.enum(['afficher', 'joindre']);
export type ModeFichier = z.infer<typeof ModeFichier>;

// Pièce jointe envoyée par Chris avec son message : contenu en base64, plafonné.
export const PieceJointe = z.object({
  nom: z.string().min(1).max(TAILLE_MAX_NOM),
  mime: z.string().min(1).max(100),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((TAILLE_MAX_PIECE * 4) / 3) + 8),
});
export type PieceJointe = z.infer<typeof PieceJointe>;

// Un fichier lu par le relais sur le poste : contenu en base64, avec son type.
export const FichierLu = z.object({ nom: z.string(), mime: z.string(), base64: z.string() });
export type FichierLu = z.infer<typeof FichierLu>;
