// Responsabilité : le vocabulaire de la parité des sessions — ce que le panneau de Desktop montre pour TOUTE session
// (pilotée, lancée hors de Lanterne, Remote Control), tiré du transcript JSONL sur le poste : contexte du dernier tour,
// résultats (fichiers envoyés ou créés), tâches en arrière-plan, dépôt de travail. Mêmes formes JSON que
// app/ui/src/parite/contrat.ts (Lanterne).
import { z } from 'zod';

export const MAX_RESULTATS = 100;
export const MAX_TACHES = 100;
export const MAX_ACTIVITE = 4000;
export const MAX_PROMPT = 20_000;
/** Contenu d'un résultat rendu à l'appli (image, page) : au-delà, refus lisible. */
export const MAX_OCTETS_RESULTAT = 8 * 1024 * 1024;
export const DELAI_PARITE_MS = 15_000;

export const ContexteParite = z.object({
  modele: z.string().nullable(),
  /** input_tokens + cache_read_input_tokens + cache_creation_input_tokens du dernier message assistant du fil
   * principal (hors isSidechain). */
  utilises: z.number(),
  sortie: z.number(),
  fenetre: z.number(),
  /** 0-100, entier. */
  pourcentage: z.number(),
  le: z.string(),
});
export type ContexteParite = z.infer<typeof ContexteParite>;

export const ResultatSession = z.object({
  chemin: z.string(),
  nom: z.string(),
  genre: z.enum(['image', 'page', 'fichier']),
  /** `envoye` : SendUserFile ; `cree` : Write d'un fichier (dernier Write de ce chemin). */
  origine: z.enum(['envoye', 'cree']),
  le: z.string(),
  existe: z.boolean(),
});
export type ResultatSession = z.infer<typeof ResultatSession>;

export const StatutTacheParite = z.enum(['en_cours', 'terminee', 'echouee', 'arretee']);
export type StatutTacheParite = z.infer<typeof StatutTacheParite>;

export const TacheParite = z.object({
  /** id du tool_use qui l'a lancée. */
  id: z.string(),
  genre: z.enum(['agent', 'commande']),
  description: z.string(),
  statut: StatutTacheParite,
  debutLe: z.string(),
  finLe: z.string().nullable(),
  modele: z.string().nullable(),
  /** Agent : agentId (subagents/agent-<agentId>.jsonl) ; commande : backgroundTaskId. */
  tacheId: z.string().nullable(),
});
export type TacheParite = z.infer<typeof TacheParite>;

export const DetailTacheParite = TacheParite.extend({
  /** Agent : consigne ; commande : la commande. */
  prompt: z.string().nullable(),
  /** Agent : dernières actions et textes du sous-agent ; commande : fin de la sortie. ≤ MAX_ACTIVITE caractères. */
  activite: z.string().nullable(),
});
export type DetailTacheParite = z.infer<typeof DetailTacheParite>;

export const DemandeFusionParite = z.object({ numero: z.number(), url: z.string(), depot: z.string() });

export const DepotTravail = z.object({
  /** Racine git (show-toplevel). */
  racine: z.string(),
  branche: z.string().nullable(),
  /** `propriétaire/dépôt` tiré de l'URL de `origin`, null sans origin GitHub lisible. */
  depot: z.string().nullable(),
  /** `dossier` : le cwd de la session est dans ce dépôt ; `transcript` : déduit des derniers outils. */
  source: z.enum(['dossier', 'transcript']),
  /** Dernière ligne `pr-link` du transcript pour ce dépôt (ou la dernière tout court si `depot` est null). */
  pr: DemandeFusionParite.nullable(),
});
export type DepotTravail = z.infer<typeof DepotTravail>;

export const PariteSession = z.object({
  /** false : aucun transcript lisible (session claude.ai sans poste, conversation pas encore commencée). */
  transcript: z.boolean(),
  contexte: ContexteParite.nullable(),
  /** Plus récent d'abord, un chemin une fois, ≤ MAX_RESULTATS. */
  resultats: z.array(ResultatSession),
  /** Tâches lancées en arrière-plan, plus récente d'abord, ≤ MAX_TACHES. */
  taches: z.array(TacheParite),
  depot: DepotTravail.nullable(),
});
export type PariteSession = z.infer<typeof PariteSession>;

export const PARITE_VIDE: PariteSession = { transcript: false, contexte: null, resultats: [], taches: [], depot: null };

/** Contenu d'un résultat (seulement un chemin présent dans `resultats`). */
export const ContenuResultat = z.object({ mime: z.string(), base64: z.string() });
export type ContenuResultat = z.infer<typeof ContenuResultat>;

/** Cible d'une commande de parité : le relais fournit l'identifiant de conversation Claude et le dossier de la session
 * (sa fiche), le poste trouve le transcript à partir de là. */
const CiblePariteCommun = {
  id: z.string(),
  sessionId: z.string().min(1).max(200),
  claudeSessionId: z.string().min(1).max(200).nullable(),
  cwd: z.string().min(1).max(4096),
};

/** Commandes de la parité (ajoutées à `CommandeRelais`). `id` est posé par le relais. */
export const commandesParite = [
  z.object({ kind: z.literal('parite'), ...CiblePariteCommun }),
  z.object({ kind: z.literal('parite_tache'), ...CiblePariteCommun, tache: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('parite_resultat'), ...CiblePariteCommun, chemin: z.string().min(1).max(4096) }),
];

export const GENRES_PARITE = ['parite', 'parite_tache', 'parite_resultat'] as const;

/** Réponse du poste à `parite_tache` : null si la tâche est inconnue de ce transcript (le relais rend 404). */
export const ReponseTacheParite = z.object({ tache: DetailTacheParite.nullable() });
export type ReponseTacheParite = z.infer<typeof ReponseTacheParite>;

/** Réponse du poste à `parite_resultat` : contenu, ou refus avec le statut HTTP à rendre (404 ou 413). */
export const ReponseResultatParite = z.discriminatedUnion('etat', [
  z.object({ etat: z.literal('ok'), mime: z.string(), base64: z.string() }),
  z.object({ etat: z.literal('refus'), statut: z.union([z.literal(404), z.literal(413)]), raison: z.string() }),
]);
export type ReponseResultatParite = z.infer<typeof ReponseResultatParite>;
