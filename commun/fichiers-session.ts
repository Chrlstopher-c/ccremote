// Responsabilité : les formes du panneau Fichiers d'une session (arbre, lecture, écriture) quand la session tourne sur
// une autre machine que l'appli. Chemins relatifs au dossier de la session ; le poste refuse tout ce qui en sort.
import { z } from 'zod';
import { EntreeFichier } from './appareil.ts';

/** Lecture et écriture d'un fichier éditable : au-delà, le fichier ne s'ouvre pas dans l'éditeur. */
export const TAILLE_MAX_TEXTE_SESSION = 2 * 1024 * 1024;

/** État git d'une entrée non commitée : colore l'arbre comme le panneau local. */
export const EtatGitSession = z.enum(['ajoute', 'modifie', 'supprime']);
export type EtatGitSession = z.infer<typeof EtatGitSession>;

export const EntreeSession = EntreeFichier.extend({ etat: EtatGitSession.nullable() });
export type EntreeSession = z.infer<typeof EntreeSession>;

export const ListeSession = z.object({
  chemin: z.string(),
  parent: z.string().nullable(),
  entrees: z.array(EntreeSession),
});
export type ListeSession = z.infer<typeof ListeSession>;

export const ContenuSession = z.object({
  chemin: z.string(),
  taille: z.number(),
  binaire: z.boolean(),
  tronque: z.boolean(),
  texte: z.string().nullable(),
});
export type ContenuSession = z.infer<typeof ContenuSession>;

export const CheminSession = z.string().max(4096);

/** Menu « / » : compétences (skills) et commandes personnalisées du projet ou de l'utilisateur. */
export const CompetenceSession = z.object({ nom: z.string(), description: z.string(), projet: z.boolean() });
export type CompetenceSession = z.infer<typeof CompetenceSession>;

/** Menu « @ » : chemins relatifs au dossier de la session, respectant le `.gitignore`. */
export const ListeFichiersSession = z.array(z.string());
