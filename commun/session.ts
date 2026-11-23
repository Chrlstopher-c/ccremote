// Responsabilité : le vocabulaire d'une session Claude Code persistante, partagé par le poste, le relais et les
// clients.
import { z } from 'zod';
import { FichierModifie } from './modifications.ts';
import { ModeFichier, NOMBRE_MAX_PIECES, PieceJointe } from './presentation.ts';
import { ConnecteurSession } from './panneau.ts';
import { CadreInvite } from './cadre-invite.ts';

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
// `claude_ai` = session Remote Control d'un compte, lue sur claude.ai (lecture seule pour l'instant).
export const Moteur = z.enum(['sdk', 'tmux', 'claude_ai']);

// Trace d'un message relayé entre deux sessions : `sortant` = envoyé à l'autre session, `entrant` = reçu de lui.
export const SensRelais = z.enum(['sortant', 'entrant']);
export type SensRelais = z.infer<typeof SensRelais>;
export const AutreSession = z.object({
  session: z.string().min(1).max(120),
  titre: z.string().max(200),
  compte: z.string().max(60),
});
export type AutreSession = z.infer<typeof AutreSession>;
export type Moteur = z.infer<typeof Moteur>;

// Mode de permission d'une session SDK. `bypassPermissions` = défaut de Lanterne : aucune demande d'outil.
export const ModeSession = z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan', 'auto']);
export type ModeSession = z.infer<typeof ModeSession>;

// Bac à sable Bash d'une session SDK : `non` (défaut), `oui` (sandbox, Bash auto-approuvé), `strict` (sans
// commande hors du bac).
export const BacASable = z.enum(['non', 'oui', 'strict']);
export type BacASable = z.infer<typeof BacASable>;

// Effort de raisonnement (SDK `effort`). Absent ou null = effort par défaut du modèle.
export const EffortSession = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type EffortSession = z.infer<typeof EffortSession>;

// Mode rapide (SDK `fastMode`) : `etat` et `raison` sont ce que le SDK rapporte (null tant qu'il n'a pas répondu
// depuis la bascule) ; `raison` n'est jamais `sdk_opt_in_required` quand la demande est fausse ; `compatible` : le
// modèle courant accepte le mode rapide (null : inconnu).
export const EtatRapideSdk = z.enum(['on', 'off', 'cooldown']);
export type EtatRapideSdk = z.infer<typeof EtatRapideSdk>;
export const ModeRapide = z.object({
  demande: z.boolean(),
  etat: EtatRapideSdk.nullable(),
  raison: z.string().nullable(),
  compatible: z.boolean().nullable(),
});
export type ModeRapide = z.infer<typeof ModeRapide>;

// Ultracode (clé de session `ultracode`, pas un niveau d'effort) : `demande` ce que Chris veut, `actif` ce que le SDK
// applique, `disponible` ce que le modèle courant permet (null : inconnu).
export const ModeUltracode = z.object({
  demande: z.boolean(),
  actif: z.boolean(),
  disponible: z.boolean().nullable(),
});
export type ModeUltracode = z.infer<typeof ModeUltracode>;

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
  permission: z.object({ outil: z.string(), entree: z.string(), suggestion: z.boolean() }).optional(),
});
export type Dialogue = z.infer<typeof Dialogue>;

// Choix unique : `index`. Choix multiple : `cases` (état voulu de toutes les cases). `texte` : réponse libre.
export const ReponseDialogue = z.object({
  id: z.string(),
  index: z.number().int().min(0).optional(),
  cases: z.array(z.number().int().min(0)).optional(),
  texte: z.string().optional(),
  passer: z.boolean().optional(), // question passée sans réponse (bouton Passer, comme Desktop)
});
export type ReponseDialogue = z.infer<typeof ReponseDialogue>;

// Remote Control : la session est connectée à claude.ai (TUI seulement). `url` : la page à ouvrir sur le téléphone.
export const RemoteControl = z.object({ actif: z.boolean(), url: z.string().nullable() });
export type RemoteControl = z.infer<typeof RemoteControl>;

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
  modeleNom: z.string().nullable().optional(), // nom affiché par le SDK pour ce modèle (absent : Lanterne le dérive)
  // instant (ISO) où ce modèle a été vu ; le plus récent gagne entre les fiches d'une conversation
  modeleLe: z.string().nullable().optional(),
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
  rapide: ModeRapide.optional(), // mode rapide : absent hors SDK ou avant le premier démarrage de la requête
  ultracode: ModeUltracode.optional(),
  tmux: z.string().nullable(), // nom de la session tmux (serveur `tmux -L claude`), null si fermée
  attachee: z.boolean(), // un terminal est attaché (kitty, web)
  pilotee: z.boolean(), // lancée par ccremote : crochets et outils de rythme actifs (autonomie, compaction)
  terminal: z.boolean().optional(), // vivante dans un terminal ordinaire, hors tmux : suivie en lecture seule
  lanceur: LanceurSession.optional(), // qui a lancé la session (registre `cc`) : kitty, quart ou echo
  dialogue: Dialogue.nullable().optional(), // dialogue du TUI en attente d'une réponse
  // Session reçue d'un pair (mode duo) : machine virtuelle = nom du pair, lecture seule côté registre.
  duo: z.object({ pair: z.string(), nom: z.string().optional(), niveau: z.enum(['lecture', 'ecriture']) }).optional(),
  nuit: Nuit.nullable().optional(), // mode nuit actif sur cette session
  // Remote Control (`/remote-control` du TUI) : session connectée à claude.ai, `url` à ouvrir sur le téléphone.
  remoteControl: RemoteControl.nullable().optional(),
  // Session Remote Control suivie depuis un compte (moteur `claude_ai`) : compte, id claude.ai, connexion.
  distant: z
    .object({
      compte: z.string(),
      idDistant: z.string(),
      connexion: z.enum(['connectee', 'deconnectee']),
      probleme: z.string().nullable(),
      cwd: z.string().optional(), // dossier réel annoncé par la session (system/init) : la reconnaît dans le parc
      // conversation Claude Code (session_id du fil) : la rattache à sa session de poste
      conversation: z.string().optional(),
      // machine et dossier réels de la jumelle de poste (affichage seulement ; `machine` reste la machine technique)
      machineReelle: z.string().optional(),
      cwdReel: z.string().optional(),
    })
    .nullable()
    .optional(),
  // Calculé par le relais, jamais par le poste : ISO de la dernière activité quand le tour est fini (attente ou
  // terminée) depuis le seuil d'inactivité ; null sinon (travail, compaction, question, démarrage, erreur, fermée).
  inactiveDepuis: z.string().nullable().optional(),
  archivee: z.boolean().optional(), // rangée par Chris : absente des listes par défaut, jamais fermée automatiquement
  migrable: z.boolean().optional(), // Desktop/terminal observée, pas encore migrée (calculé par le relais)
  migreeVers: z.string().nullable().optional(), // migrée vers cette session de Lanterne (calculé par le relais)
  epinglee: z.boolean().optional(), // épinglée par Chris : section « Épinglés » en tête de la liste
  style_sortie: z.string().nullable().optional(), // style de sortie Claude (SDK) ; null ou absent = défaut
  prompt_systeme: z.string().max(8000).nullable().optional(), // prompt système de la conversation ; null = aucun
  // Session d'un invité (vue des autres : titre générique, fil refusé) : membre et nom affiché.
  invite: z.object({ membre: z.string(), nom: z.string() }).optional(),
  annexe_de: z.string().nullable().optional(), // conversation annexe : identifiant de la session parente
  parent: z.string().nullable().optional(), // née d'une duplication : identifiant de la session d'origine
  bac_a_sable: BacASable.optional(), // réglé à la création, réappliqué à la reprise ; absent = non
  nonLue: z.boolean().optional(), // fin de tour pas encore vue par Chris (drapeau du relais)
  // Connecteurs MCP de la session relevés à l'initialisation du SDK et à chaque lecture vivante : gardés au repos.
  connecteurs: z.array(ConnecteurSession).optional(),
  creeLe: z.string(),
  majLe: z.string(),
});
export type ResumeSession = z.infer<typeof ResumeSession>;

// `agent` : l'id de l'appel d'outil qui a lancé le sous-agent auteur de l'événement (absent = fil principal).
const deAgent = { agent: z.string().optional() };

export const Evenement = z.discriminatedUnion('type', [
  // `uuid` : identifiant de l'entrée du transcript (SDK), stable : sert à rembobiner, dupliquer et épingler.
  // `auteur` : nom d'utilisateur de la machine qui a envoyé le message (absent : fil antérieur au mode duo).
  z.object({
    type: z.literal('message'),
    texte: z.string(),
    uuid: z.string().optional(),
    auteur: z.string().optional(),
  }),
  z.object({ type: z.literal('texte'), texte: z.string(), uuid: z.string().optional(), ...deAgent }),
  // Chapitre épinglé sur un message de l'utilisateur ou une réponse (uuid de `tour_fini`) ; `epingle` false le retire.
  z.object({ type: z.literal('chapitre'), uuid: z.string(), epingle: z.boolean() }),
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
  // Liste de tâches (TodoWrite) : chaque mise à jour remplace la précédente dans le fil.
  z.object({
    type: z.literal('taches'),
    taches: z.array(z.object({ contenu: z.string(), etat: z.enum(['attente', 'en_cours', 'fait']) })),
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
  // Dialogue résolu par Chris (question, permission ou plan) : le fil le rejoue avec sa réponse, après rechargement.
  z.object({
    type: z.literal('dialogue_resolu'),
    dialogue: Dialogue,
    reponses: z.array(z.string()).optional(), // question : libellés choisis, ou saisie libre
    decision: z.enum(['autoriser', 'toujours', 'refuser']).optional(), // permission ou plan
  }),
  z.object({ type: z.literal('compaction'), avant: z.number(), apres: z.number(), declencheur: z.string() }),
  z.object({ type: z.literal('relance'), raison: z.string() }),
  // Migration d'une session Desktop/terminal vers Lanterne : `sortie` dans l'ancienne (`session` = la nouvelle),
  // `entree` dans la nouvelle (`session` = l'ancienne).
  z.object({ type: z.literal('migration'), sens: z.enum(['sortie', 'entree']), session: z.string(), titre: z.string() }),
  z.object({
    type: z.literal('tour_fini'),
    dureeMs: z.number(),
    contexte: z.number(),
    entree: z.number().optional(), // jetons lus pendant le tour (SDK) ; absent pour une session tmux
    sortie: z.number().optional(), // jetons générés pendant le tour
    uuid: z.string().optional(), // dernière entrée assistant du tour (SDK) : désigne la réponse (dupliquer, épingler)
    coutUsd: z.number().nonnegative().optional(), // coût cumulé de la session, lu du transcript (session suivie) : absent sinon
  }),
  // Présentation (outils `lanterne` et pièces de Chris) : `fichier` désigne un fichier stocké sur le poste, servi par
  // la route du relais ; `artefact` est une version d'une page HTML ; `widget` un SVG ou une page HTML rendus en place.
  z.object({
    type: z.literal('fichier'),
    fichier: z.string(),
    nom: z.string(),
    mime: z.string(),
    taille: z.number(),
    mode: ModeFichier,
    legende: z.string().nullable(),
  }),
  z.object({
    type: z.literal('artefact'),
    artefact: z.string(),
    version: z.number().int(),
    fichier: z.string(),
    titre: z.string(),
    mime: z.string(),
    taille: z.number(),
  }),
  z.object({ type: z.literal('widget'), fichier: z.string(), titre: z.string(), mime: z.string(), taille: z.number() }),
  // Intégration d'un module (outil `module_afficher`) : rendue par l'interface, à la volée et à la relecture.
  z.object({
    type: z.literal('integration'),
    module: z.string(),
    integration: z.string(),
    donnees: z.record(z.string(), z.unknown()),
    titre: z.string().optional(),
  }),
  z.object({
    type: z.literal('image'),
    fichier: z.string(),
    nom: z.string(),
    mime: z.string(),
    taille: z.number(),
    origine: z.enum(['outil', 'utilisateur']),
    ...deAgent,
  }),
  // Fichiers touchés par un tour (Edit/Write relevés par le poste), émis juste avant `tour_fini` ; `tour_annule`
  // quand Chris a remis ces fichiers dans leur état d'avant le tour.
  z.object({ type: z.literal('fichiers_tour'), tour: z.string(), fichiers: z.array(FichierModifie) }),
  z.object({ type: z.literal('tour_annule'), tour: z.string() }),
  z.object({ type: z.literal('erreur'), message: z.string() }),
  // Message relayé vers / depuis une autre session (`autre` : la session à l'autre bout). Gardé par le poste, daté.
  z.object({ type: z.literal('relais'), sens: SensRelais, ...AutreSession.shape, texte: z.string() }),
  // Session passée à un pair du mode duo (passer la main) : la session d'origine garde cette ligne.
  z.object({ type: z.literal('duo_main'), vers: z.string().min(1).max(120) }),
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
  effort: EffortSession.optional(), // posé avant le premier tour ; absent = défaut du modèle
  rapide: z.boolean().optional(), // mode rapide demandé à l'ouverture (moteur SDK)
  ultracode: z.boolean().optional(), // Ultracode demandé à l'ouverture (moteur SDK)
  style_sortie: z.string().min(1).max(80).nullable().optional(),
  prompt_systeme: z.string().max(8000).optional(), // prompt système de la conversation, ajouté à celui de l'appli
  invite: CadreInvite.optional(), // session d'invité : cadre imposé par le nœud du chef
  bac_a_sable: BacASable.optional(),
  controle_distant: z.boolean().optional(), // Remote Control branché à la fin du premier tour
  pieces: z.array(PieceJointe).max(NOMBRE_MAX_PIECES).optional(), // jointes au premier message (moteur SDK)
  // Composé par le relais pour la machine cible : ce que la session a le droit de joindre.
  parc: z.array(z.object({ id: z.string(), description: z.string(), racines: z.array(z.string()) })),
});
export type DemandeSession = z.infer<typeof DemandeSession>;
