// Responsabilité : le vocabulaire d'une session Claude Code persistante, partagé par le poste, le relais et les
// clients.
import { z } from 'zod';

export const StatutSession = z.enum([
  'demarrage', // tmux + claude se lancent
  'travail', // un tour est en cours
  'compaction', // /compact envoyé par le poste, en attente de la reprise
  'attente', // tour fini, la session attend un message de Chris
  'question', // l'agent a posé une question : attente explicite de Chris
  'terminee', // objectif atteint déclaré par l'agent
  'erreur',
  'fermee', // plus de tmux : reprenable (claude --resume)
]);
export type StatutSession = z.infer<typeof StatutSession>;

export const Projet = z.object({
  machine: z.string(),
  chemin: z.string(),
  nom: z.string(),
});
export type Projet = z.infer<typeof Projet>;

// Un dialogue affiché par le TUI et bloquant la session tant que personne n'y répond.
// `questions` : l'outil AskUserQuestion (structuré, lu dans le transcript) ; `choix` : tout autre menu du TUI
// (permission, validation d'un plan…) relevé à l'écran.
export const QuestionDialogue = z.object({
  question: z.string(),
  entete: z.string(),
  multiple: z.boolean(),
  options: z.array(z.object({ libelle: z.string(), description: z.string() })),
});
export type QuestionDialogue = z.infer<typeof QuestionDialogue>;

export const Dialogue = z.discriminatedUnion('genre', [
  z.object({ genre: z.literal('questions'), id: z.string(), questions: z.array(QuestionDialogue).min(1) }),
  z.object({ genre: z.literal('choix'), id: z.string(), titre: z.string(), options: z.array(z.string()).min(1) }),
]);
export type Dialogue = z.infer<typeof Dialogue>;

// `choix` : indices (0 = première option) ; `autre` : réponse libre, qui remplace les choix pour cette question.
export const ReponseDialogue = z.discriminatedUnion('genre', [
  z.object({
    genre: z.literal('questions'),
    id: z.string(),
    reponses: z.array(z.object({ choix: z.array(z.number().int().min(0)), autre: z.string().optional() })).min(1),
  }),
  z.object({ genre: z.literal('choix'), id: z.string(), index: z.number().int().min(0) }),
]);
export type ReponseDialogue = z.infer<typeof ReponseDialogue>;

export const ResumeSession = z.object({
  id: z.string(),
  machine: z.string(),
  projet: Projet,
  cwd: z.string(),
  titre: z.string(),
  objectif: z.string().nullable(),
  modele: z.string(),
  compte: z.string(),
  autonomie: z.boolean(),
  statut: StatutSession,
  contexte: z.object({ tokens: z.number(), max: z.number() }),
  etapes: z.number(),
  compactions: z.number(),
  claudeSessionId: z.string().nullable(),
  tmux: z.string().nullable(), // nom de la session tmux (serveur `tmux -L claude`), null si fermée
  attachee: z.boolean(), // un terminal est attaché (kitty, web)
  pilotee: z.boolean(), // lancée par ccremote : crochets et outils de rythme actifs (autonomie, compaction)
  terminal: z.boolean().optional(), // vivante dans un terminal ordinaire, hors tmux : suivie en lecture seule
  dialogue: Dialogue.nullable().optional(), // dialogue du TUI en attente d'une réponse
  creeLe: z.string(),
  majLe: z.string(),
});
export type ResumeSession = z.infer<typeof ResumeSession>;

// `agent` : l'id de l'appel d'outil qui a lancé le sous-agent auteur de l'événement (absent = fil principal).
const deAgent = { agent: z.string().optional() };

export const Evenement = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), texte: z.string() }),
  z.object({ type: z.literal('texte'), texte: z.string(), ...deAgent }),
  z.object({ type: z.literal('reflexion'), texte: z.string(), ...deAgent }),
  z.object({
    type: z.literal('outil'),
    id: z.string(),
    nom: z.string(),
    resume: z.string(),
    detail: z.string(),
    ...deAgent,
  }),
  z.object({
    type: z.literal('resultat_outil'),
    outilId: z.string(),
    extrait: z.string(),
    erreur: z.boolean(),
    ...deAgent,
  }),
  z.object({
    type: z.literal('sous_agent'),
    id: z.string(),
    description: z.string(),
    modele: z.string(),
    genre: z.string(),
  }),
  z.object({ type: z.literal('etape'), resume: z.string(), suite: z.string() }),
  z.object({ type: z.literal('objectif_atteint'), bilan: z.string() }),
  z.object({ type: z.literal('question'), question: z.string() }),
  z.object({ type: z.literal('compaction'), avant: z.number(), apres: z.number(), declencheur: z.string() }),
  z.object({ type: z.literal('relance'), raison: z.string() }),
  z.object({ type: z.literal('tour_fini'), dureeMs: z.number(), contexte: z.number() }),
  z.object({ type: z.literal('erreur'), message: z.string() }),
]);
export type Evenement = z.infer<typeof Evenement>;

export const DemandeSession = z.object({
  sessionId: z.string(),
  projet: Projet,
  titre: z.string().min(1).max(120),
  message: z.string().min(1),
  objectif: z.string().nullable(),
  autonomie: z.boolean(),
  modele: z.string().optional(),
  compte: z.string().optional(),
  // Composé par le relais pour la machine cible : ce que la session a le droit de joindre.
  parc: z.array(z.object({ id: z.string(), description: z.string(), racines: z.array(z.string()) })),
});
export type DemandeSession = z.infer<typeof DemandeSession>;
