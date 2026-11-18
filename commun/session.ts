// Responsabilité : le vocabulaire d'une session Claude Code persistante, partagé par le poste, le relais et les
// clients.
import { z } from 'zod';

export const LanceurSession = z.enum(['kitty', 'quart', 'echo']); // qui a lancé la session (registre `cc`)
export type LanceurSession = z.infer<typeof LanceurSession>;

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

// Comment la session tourne sur le poste : `sdk` = Claude Agent SDK piloté par le poste (défaut des sessions ouvertes
// depuis l'app), `tmux` = vrai TUI dans `tmux -L claude` (sessions tapées au clavier, anciennes sessions).
export const Moteur = z.enum(['sdk', 'tmux']);
export type Moteur = z.infer<typeof Moteur>;

// Mode de permission d'une session SDK. `bypassPermissions` = défaut de Lanterne : aucune demande d'outil.
export const ModeSession = z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']);
export type ModeSession = z.infer<typeof ModeSession>;

// Effort de raisonnement (SDK `effort`). Absent ou null = effort par défaut du modèle.
export const EffortSession = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type EffortSession = z.infer<typeof EffortSession>;

export const Projet = z.object({
  machine: z.string(),
  chemin: z.string(),
  nom: z.string(),
});
export type Projet = z.infer<typeof Projet>;

// Un dialogue affiché par le TUI et bloquant la session tant que personne n'y répond (AskUserQuestion, permission,
// validation d'un plan…), relevé à l'écran du pane : une question à la fois, comme au clavier.
export const Dialogue = z.object({
  id: z.string(),
  titre: z.string(),
  options: z.array(z.object({ libelle: z.string(), description: z.string() })).min(1),
  multiple: z.boolean(), // cases à cocher (AskUserQuestion multiSelect)
  saisie: z.number().int().nullable(), // l'option « Type something » : réponse libre
  coches: z.array(z.number().int()), // cases déjà cochées
  // Demande de permission d'un outil (mode autre que bypass) : options Autoriser / Toujours / Refuser.
  permission: z
    .object({ outil: z.string(), entree: z.string(), suggestion: z.boolean() })
    .optional(),
});
export type Dialogue = z.infer<typeof Dialogue>;

// Choix unique : `index`. Choix multiple : `cases` (état voulu de toutes les cases). `texte` : réponse libre.
export const ReponseDialogue = z.object({
  id: z.string(),
  index: z.number().int().min(0).optional(),
  cases: z.array(z.number().int().min(0)).optional(),
  texte: z.string().optional(),
});
export type ReponseDialogue = z.infer<typeof ReponseDialogue>;

// Mode nuit (config Claude Code : ~/.claude/night) : Chris dort, la session travaille seule jusqu'à tout finir.
export const Nuit = z.object({
  depuisH: z.number(), // heures écoulées depuis l'activation
  casesOuvertes: z.number().nullable(), // cases `- [ ]` restantes du plan (null : pas encore compté)
  relances: z.number(), // relances du hook Stop (côté Claude)
  reveils: z.number(), // réveils par le poste (session à l'arrêt, Chris muet)
});
export type Nuit = z.infer<typeof Nuit>;

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
  moteur: Moteur.optional(), // absent = tmux (postes antérieurs)
  mode: ModeSession.optional(), // absent = bypassPermissions (comportement antérieur : tout autorisé)
  effort: EffortSession.nullable().optional(), // absent ou null = défaut du modèle
  tmux: z.string().nullable(), // nom de la session tmux (serveur `tmux -L claude`), null si fermée
  attachee: z.boolean(), // un terminal est attaché (kitty, web)
  pilotee: z.boolean(), // lancée par ccremote : crochets et outils de rythme actifs (autonomie, compaction)
  terminal: z.boolean().optional(), // vivante dans un terminal ordinaire, hors tmux : suivie en lecture seule
  lanceur: LanceurSession.optional(), // qui a lancé la session (registre `cc`) : kitty, quart ou echo
  dialogue: Dialogue.nullable().optional(), // dialogue du TUI en attente d'une réponse
  nuit: Nuit.nullable().optional(), // mode nuit actif sur cette session
  // Calculé par le relais, jamais par le poste : ISO de la dernière activité quand le tour est fini (attente ou
  // terminée) depuis le seuil d'inactivité ; null sinon (travail, compaction, question, démarrage, erreur, fermée).
  inactiveDepuis: z.string().nullable().optional(),
  archivee: z.boolean().optional(), // rangée par Chris : absente des listes par défaut, jamais fermée automatiquement
  creeLe: z.string(),
  majLe: z.string(),
});
export type ResumeSession = z.infer<typeof ResumeSession>;

// `agent` : l'id de l'appel d'outil qui a lancé le sous-agent auteur de l'événement (absent = fil principal).
const deAgent = { agent: z.string().optional() };

export const Evenement = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), texte: z.string() }),
  z.object({ type: z.literal('texte'), texte: z.string(), ...deAgent }),
  // Texte ou réflexion en cours d'écriture (SDK, includePartialMessages) : remplacé par l'événement final (`texte`,
  // `reflexion`), jamais persisté. `genre` absent = texte.
  z.object({
    type: z.literal('flux'),
    bloc: z.string(),
    delta: z.string(),
    genre: z.enum(['texte', 'reflexion']).optional(),
    ...deAgent,
  }),
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
  moteur: Moteur.optional(), // absent = sdk
  mode: ModeSession.optional(), // absent = bypassPermissions
  // Composé par le relais pour la machine cible : ce que la session a le droit de joindre.
  parc: z.array(z.object({ id: z.string(), description: z.string(), racines: z.array(z.string()) })),
});
export type DemandeSession = z.infer<typeof DemandeSession>;
