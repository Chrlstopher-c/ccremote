// Responsabilité : le protocole de la fédération « mes machines » (contrat v2, étape 3) — messages en clair de
// l'appairage entre nœuds, puis messages chiffrés de bout en bout une fois le canal établi. Aucune logique ici.
import { z } from 'zod';
import { GENRES_MEMBRE } from './aiguilleur.ts';
import { LONGUEUR_MAX_GESTE, METHODES_GESTE } from './gestes-federes.ts';
import { TAILLE_MAX_TEXTE_SESSION } from './fichiers-session.ts';
import { Evenement, Projet, ResumeSession } from './session.ts';
import { CibleTerminal } from './appareil.ts';
import { ActiviteInvite } from './invites.ts';
import { ClaudeAnnuler, ClaudeEntete, ClaudeFin, ClaudeRequete, MORCEAUX_MAX_FLUX } from './relais-claude.ts';
import { ID_MEMBRE } from './charte-droits.ts';

/** Taille maximale d'un message en clair (avant chiffrement) : la charge de l'aiguilleur est plafonnée à 1 Mio. */
export const TAILLE_MAX_CLAIR_OCTETS = 600_000;
/** Événements du fil renvoyés pour une session distante (le plus récent en dernier). */
export const TAILLE_FIL_FEDERE = 200;
/** Sessions par message d'instantané (la tête, comme chaque page de suite). */
export const NOMBRE_MAX_SESSIONS_FEDEREES = 150;
/** Pages de suite d'un instantané, au plus : au-delà, les sessions les plus anciennes ne sont pas annoncées. */
export const NOMBRE_MAX_PAGES_INSTANTANE = 100;
/** Abonnements au fil en direct qu'un pair peut tenir ouverts sur un nœud. */
export const NOMBRE_MAX_ABONNEMENTS = 64;
/** Délai d'une demande entre nœuds sans réponse : au-delà, le canal est coupé. */
export const DELAI_REPONSE_FEDEREE_MS = 10_000;
/** Demandes d'appairage en attente sur un nœud, au plus : au-delà, la nouvelle est refusée tout de suite. */
export const NOMBRE_MAX_DEMANDES = 5;

const IDENTITE = /^[A-Za-z0-9_-]{86}$/;
const NOM = z.string().trim().min(1).max(80);
const SESSION = z.string().min(1).max(200);
const REF = z.string().min(1).max(64);
const TEXTE = z.string().min(1).max(TAILLE_MAX_TEXTE_SESSION);
const METHODE_API = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const CHEMIN_API = z.string().min(5).max(4096).regex(/^\/api\//);
/** Un delta de texte relayé : les deltas d'un même bloc se regroupent avant l'envoi, bornés ici. */
export const TAILLE_FLUX_MAX_CARACTERES = 32_000;
/** Un corps qui dépasse une trame part en morceaux de cette taille (en caractères : jamais plus de 384 Ko d'UTF-8). */
export const TAILLE_MORCEAU_CARACTERES = 128 * 1024;
/** Plus grand contenu relayé (corps encodé) : au-delà de ce que les limites locales permettent, refus. */
export const TAILLE_MAX_TRANSFERT_CARACTERES = 16 * 1024 * 1024;
export const NOMBRE_MAX_MORCEAUX = TAILLE_MAX_TRANSFERT_CARACTERES / TAILLE_MORCEAU_CARACTERES;
/**
 * Morceau d'un corps servi à un appareil par l'aiguilleur : petit, car une trame de plus de ~16 Ko est tronquée par
 * certains transports WebSocket (URLSession hors iOS). Le fil de la fédération garde les grands morceaux.
 */
export const TAILLE_MORCEAU_APPAREIL_CARACTERES = 4 * 1024;
export const NOMBRE_MAX_MORCEAUX_APPAREIL = TAILLE_MAX_TRANSFERT_CARACTERES / TAILLE_MORCEAU_APPAREIL_CARACTERES;

export const IdentitePubliqueTexte = z.string().regex(IDENTITE);

/** Charte signée du réseau (texte JSON), au plus. */
export const TAILLE_MAX_CHARTE_CARACTERES = 256 * 1024;
/** Actions d'un chef sur la machine d'un nœud. `reveiller` n'en est pas : il part d'un nœud voisin en ligne. */
export const ACTIONS_NOEUD = ['arreter', 'pause', 'reprendre', 'redemarrer'] as const;
export type ActionNoeud = (typeof ACTIONS_NOEUD)[number];
/** Ordre signé par un téléphone chef (`commun/ordre-machine.ts` le lit) : texte JSON exact, Ed25519 en base64url. */
export const TAILLE_MAX_ORDRE_CARACTERES = 2000;
export const OrdreSigne = z.strictObject({
  texte: z.string().min(2).max(TAILLE_MAX_ORDRE_CARACTERES),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type OrdreSigne = z.infer<typeof OrdreSigne>;
const ETAT_FONCTION = z.enum(['lancee', 'arretee', 'absente']);
/** État d'une machine de nœud (`etat_noeud`) : objets ouverts, un champ inconnu d'une version plus récente passe. */
export const EtatNoeud = z.object({
  le: z.string().max(40),
  cpu: z.number().min(0).max(100).nullable(),
  charge: z.number().min(0).nullable(),
  memoire: z.object({ utilisee: z.number().min(0), totale: z.number().min(0) }).nullable(),
  gpu: z
    .array(
      z.object({
        nom: z.string().max(120),
        utilisation: z.number().min(0).max(100).nullable(),
        memoireUtilisee: z.number().min(0).nullable(),
        memoireTotale: z.number().min(0).nullable(),
      }),
    )
    .max(8)
    .nullable(),
  reseau: z.object({ mac: z.string().max(40), diffusion: z.string().max(60) }).nullable(),
  pause: z.boolean(),
  fonctions: z.object({ voix: ETAT_FONCTION, dictee: ETAT_FONCTION }),
  comptes: z.array(z.string().max(200)).max(20),
  compte: z.string().max(200).nullable(),
  peutArreter: z.boolean(),
  peutRedemarrer: z.boolean(),
  reveilPossible: z.boolean(),
});
export type EtatNoeud = z.infer<typeof EtatNoeud>;

/** En clair : l'appairage (présentation, décision) et l'enveloppe du chiffrement (poignée, trame). */
export const MessageEnClair = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('presentation'),
    identite: IdentitePubliqueTexte,
    nom: NOM,
    genre: z.enum(GENRES_MEMBRE).optional(),
  }),
  z.strictObject({ t: z.literal('accord') }),
  z.strictObject({ t: z.literal('refus'), raison: z.string().max(200) }),
  z.strictObject({ t: z.literal('poignee'), m: z.unknown() }),
  z.strictObject({ t: z.literal('poignee-reponse'), m: z.unknown() }),
  z.strictObject({ t: z.literal('chiffre'), trame: z.string().min(1).max(1_000_000) }),
]);
export type MessageEnClair = z.infer<typeof MessageEnClair>;

// `seq` : numéro de l'événement chez le nœud qui tient la session (absent : nœud d'avant le relais des gestes).
const EvenementFede = z.object({ seq: z.number().int().nonnegative().optional(), ts: z.string(), evt: Evenement });

/** Plafond des appareils admis (et des révocations) dans une photo : au-delà, la photo est refusée. */
export const NOMBRE_MAX_APPAREILS_ADMIS = 500;
const MEMBRE = z.string().regex(/^[a-f0-9]{12}$/);

/** Un appareil admis, tel qu'un nœud le propage à ses pairs : de quoi l'accepter en lien direct, sans demande. */
export const AppareilAdmis = z.strictObject({
  id: MEMBRE,
  nom: NOM,
  identite: IdentitePubliqueTexte,
  admisPar: MEMBRE,
  le: z.string().min(1).max(40),
});
export type AppareilAdmis = z.infer<typeof AppareilAdmis>;

/** La machine du nœud telle qu'il l'annonce : de quoi la ranger et y créer une session chez ses pairs. */
export const MachineAnnoncee = z.strictObject({
  description: z.string().max(200),
  racines: z.array(z.string().max(4096)).max(50),
  projets: z.array(Projet).max(500),
  comptes: z.array(z.string().max(200)).max(20),
});
export type MachineAnnoncee = z.infer<typeof MachineAnnoncee>;

/** Chiffré de bout en bout : tout ce qui concerne les sessions d'un nœud. */
export const MessageChiffre = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('instantane'),
    machine: NOM,
    nom: NOM,
    sessions: z.array(ResumeSession).max(NOMBRE_MAX_SESSIONS_FEDEREES),
    vue: MachineAnnoncee.optional(),
  }),
  // Pages des sessions au-delà de la tête (les 150 plus récentes), numérotées `rang` sur `total`. Elles partent avant la
  // tête : le pair remplace sa liste d'un coup, à la réception de la tête. Un nœud d'avant ignore ce genre de message.
  z.strictObject({
    t: z.literal('instantane_suite'),
    rang: z.number().int().min(1).max(NOMBRE_MAX_PAGES_INSTANTANE),
    total: z.number().int().min(1).max(NOMBRE_MAX_PAGES_INSTANTANE),
    sessions: z.array(ResumeSession).max(NOMBRE_MAX_SESSIONS_FEDEREES),
  }),
  z.strictObject({
    t: z.literal('evenement'),
    session: SESSION,
    seq: z.number().int().nonnegative().optional(),
    ts: z.string(),
    evt: Evenement,
  }),
  z.strictObject({ t: z.literal('fil'), ref: REF, session: SESSION, ami: ID_MEMBRE.optional() }),
  z.strictObject({
    t: z.literal('fil_reponse'),
    ref: REF,
    session: SESSION,
    evenements: z.array(EvenementFede).max(TAILLE_FIL_FEDERE),
  }),
  z.strictObject({ t: z.literal('ecrire'), ref: REF, session: SESSION, texte: TEXTE, ami: ID_MEMBRE.optional() }),
  z.strictObject({ t: z.literal('interrompre'), ref: REF, session: SESSION, ami: ID_MEMBRE.optional() }),
  z.strictObject({
    t: z.literal('ouvrir'),
    ref: REF,
    machine: NOM,
    chemin: z.string().min(1).max(4096),
    message: TEXTE,
    ami: ID_MEMBRE.optional(),
  }),
  z.strictObject({
    t: z.literal('reponse'),
    ref: REF,
    ok: z.boolean(),
    raison: z.string().max(300).optional(),
    session: SESSION.optional(),
  }),
  z.strictObject({ t: z.literal('revocation') }),
  // Route relayée : `geste` = suffixe validé par commun/gestes-federes.ts ; `session` ou `machine` selon la portée.
  z.strictObject({
    t: z.literal('geste'),
    ref: REF,
    geste: z.string().min(1).max(LONGUEUR_MAX_GESTE),
    methode: z.enum(METHODES_GESTE),
    session: SESSION.optional(),
    machine: NOM.optional(),
    ami: ID_MEMBRE.optional(),
    requete: z.string().max(4000).optional(),
    corps: z.string().max(TAILLE_MAX_CLAIR_OCTETS).optional(),
    // Corps en morceaux : `morceaux` = leur nombre, envoyés avant ce message sous la même référence.
    morceaux: z.number().int().min(1).max(NOMBRE_MAX_MORCEAUX).optional(),
  }),
  // `codage: base64` : corps binaire (fichier téléchargé), `type` : son type MIME.
  z.strictObject({
    t: z.literal('geste_reponse'),
    ref: REF,
    statut: z.number().int().min(100).max(599),
    corps: z.string().max(TAILLE_MAX_CLAIR_OCTETS),
    type: z.string().max(120).optional(),
    codage: z.literal('base64').optional(),
    morceaux: z.number().int().min(1).max(NOMBRE_MAX_MORCEAUX).optional(),
  }),
  // Un morceau d'un corps trop grand pour une trame (même référence que la requête ou la réponse).
  z.strictObject({
    t: z.literal('morceau'),
    ref: REF,
    rang: z.number().int().min(0).max(MORCEAUX_MAX_FLUX - 1),
    corps: z.string().max(TAILLE_MORCEAU_CARACTERES),
  }),
  // Confirmation d'un outil du nœud (Claude demande, Chris répond) : relayée à ses pairs, qui l'affichent.
  z.strictObject({
    t: z.literal('confirmation'),
    confirmation: z.strictObject({
      id: REF,
      action: z.string().max(60),
      cible: z.string().max(120),
      resume: z.string().max(500),
      statut: z.enum(['en_attente', 'accordee', 'refusee', 'expiree']),
      cree_le: z.string().max(40),
    }),
  }),
  // Appareil (client) : une requête de l'API clients, rejouée par le nœud sur ses routes locales.
  // `codage: base64` : corps binaire (image, fichier), `type` : son type MIME. `morceaux` : corps en morceaux.
  z.strictObject({
    t: z.literal('api'),
    ref: REF,
    methode: METHODE_API,
    chemin: CHEMIN_API,
    corps: z.string().max(TAILLE_MAX_CLAIR_OCTETS).optional(),
    codage: z.literal('base64').optional(),
    type: z.string().max(120).optional(),
    morceaux: z.number().int().min(1).max(NOMBRE_MAX_MORCEAUX_APPAREIL).optional(),
  }),
  z.strictObject({
    t: z.literal('api_reponse'),
    ref: REF,
    statut: z.number().int().min(100).max(599),
    corps: z.string().max(TAILLE_MAX_CLAIR_OCTETS),
    codage: z.literal('base64').optional(),
    type: z.string().max(120).optional(),
    morceaux: z.number().int().min(1).max(NOMBRE_MAX_MORCEAUX_APPAREIL).optional(),
  }),
  // Réponse en flux (requête `?flux=1`, corps binaire) : l'en-tête, puis ses morceaux (`morceau`, base64, au fil de
  // leur arrivée) et la fin (`morceaux` = leur nombre ; `ok` faux si le flux a été coupé en route).
  z.strictObject({
    t: z.literal('api_flux'),
    ref: REF,
    statut: z.number().int().min(100).max(599),
    type: z.string().max(120).optional(),
  }),
  z.strictObject({
    t: z.literal('api_fin'),
    ref: REF,
    morceaux: z.number().int().min(0).max(NOMBRE_MAX_MORCEAUX_APPAREIL),
    ok: z.boolean(),
  }),
  // Flux en direct par l'aiguilleur : l'appareil demande les événements du nœud, qui acquitte ; chaque événement
  // (`corps` : un MessageClient en JSON, en morceaux si besoin) part ensuite sans requête.
  z.strictObject({ t: z.literal('diffusion_ouvrir') }),
  z.strictObject({ t: z.literal('diffusion_fermer') }),
  z.strictObject({ t: z.literal('diffusion_ouverte') }),
  z.strictObject({
    t: z.literal('diffusion'),
    ref: REF,
    corps: z.string().max(TAILLE_MAX_CLAIR_OCTETS),
    morceaux: z.number().int().min(1).max(NOMBRE_MAX_MORCEAUX).optional(),
  }),
  // Texte en cours d'écriture (delta, non persisté) : relayé en direct à qui suit le fil de la session.
  z.strictObject({
    t: z.literal('flux'),
    session: SESSION,
    bloc: z.string().min(1).max(200),
    delta: z.string().max(TAILLE_FLUX_MAX_CARACTERES),
    genre: z.enum(['texte', 'reflexion']).optional(),
    agent: z.string().max(200).optional(),
  }),
  // Terminal d'une session distante : l'ouverture est une requête (réponse `reponse`), le reste suit le lien.
  z.strictObject({
    t: z.literal('terminal_ouvrir'),
    ref: REF,
    terminal: REF,
    session: SESSION,
    colonnes: z.number().int().min(2).max(1000),
    lignes: z.number().int().min(2).max(1000),
  }),
  // Terminal d'une machine du nœud (le shell ou tmux d'un poste) : même canal, même suite de messages.
  z.strictObject({
    t: z.literal('terminal_poste'),
    ref: REF,
    terminal: REF,
    machine: NOM,
    cible: CibleTerminal,
    colonnes: z.number().int().min(2).max(1000),
    lignes: z.number().int().min(2).max(1000),
  }),
  z.strictObject({ t: z.literal('terminal_entree'), terminal: REF, base64: z.string().max(TAILLE_MAX_CLAIR_OCTETS) }),
  z.strictObject({
    t: z.literal('terminal_taille'),
    terminal: REF,
    colonnes: z.number().int().min(2).max(1000),
    lignes: z.number().int().min(2).max(1000),
  }),
  z.strictObject({ t: z.literal('terminal_fermer'), terminal: REF }),
  z.strictObject({ t: z.literal('terminal_sortie'), terminal: REF, base64: z.string().max(TAILLE_MAX_CLAIR_OCTETS) }),
  z.strictObject({ t: z.literal('terminal_fin'), terminal: REF, code: z.number().int().nullable() }),
  // Photo des admissions d'appareils : `liste` = appareils admis chez le nœud (les siens et ceux reçus de ses pairs),
  // `retires` = identifiants des appareils révoqués (définitif). Entre nœuds appariés seulement : un appareil qui
  // l'envoie ferme son canal. Remplace tout autre chemin d'admission.
  z.strictObject({
    t: z.literal('admissions'),
    liste: z.array(AppareilAdmis).max(NOMBRE_MAX_APPAREILS_ADMIS),
    retires: z.array(MEMBRE).max(NOMBRE_MAX_APPAREILS_ADMIS),
  }),
  // Synchronisation sur demande : le contenu est validé par le service synchro (commun/synchro.ts), pas ici.
  z.strictObject({ t: z.literal('synchro'), m: z.unknown() }),
  // Réseau v3 (RESEAU-V3-ETAPE2.md). Charte signée par un chef : `texte` = JSON exact signé (commun/charte.ts le lit),
  // `signature` = Ed25519 en base64url. Entre nœuds appariés seulement. Un nœud d'avant ignore ces genres.
  z.strictObject({
    t: z.literal('charte'),
    texte: z.string().min(2).max(TAILLE_MAX_CHARTE_CARACTERES),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  }),
  // Action d'un chef sur la machine d'un nœud : l'émetteur doit être chef dans la charte du nœud visé (identité du
  // canal chiffré). Réponse : `reponse` (même `ref`).
  // `ordre` : un téléphone chef relié à un autre nœud signe l'action ; le nœud visé la vérifie dans sa charte.
  z.strictObject({
    t: z.literal('action_noeud'),
    ref: REF,
    action: z.enum(ACTIONS_NOEUD),
    ordre: OrdreSigne.optional(),
  }),
  // État de la machine d'un nœud, envoyé à ses pairs à l'ouverture du lien puis périodiquement. Champs ouverts.
  z.strictObject({ t: z.literal('etat_noeud'), etat: EtatNoeud }),
  // Activité des invités dont ce nœud fait tourner les sessions (télémétrie active), envoyée aux chefs : jamais de
  // contenu. Un nœud d'avant ignore ce genre de message.
  z.strictObject({
    t: z.literal('activite_invites'),
    activites: z.array(z.strictObject({ membre: MEMBRE, activite: ActiviteInvite })).max(200),
  }),
  // Relais Claude d'invité (commun/relais-claude.ts) : requête, en-têtes, fin et annulation ; morceaux au même titre.
  ClaudeRequete,
  ClaudeEntete,
  ClaudeFin,
  ClaudeAnnuler,
]);
export type MessageChiffre = z.infer<typeof MessageChiffre>;
export type EvenementFedere = z.infer<typeof EvenementFede>;

/** Lit un message en clair reçu (null s'il n'est pas du protocole). */
export function lireMessageEnClair(brut: unknown): MessageEnClair | null {
  const r = MessageEnClair.safeParse(brut);
  return r.success ? r.data : null;
}

/** Lit un message chiffré déchiffré (null s'il n'est pas du protocole). */
export function lireMessageChiffre(brut: unknown): MessageChiffre | null {
  const r = MessageChiffre.safeParse(brut);
  return r.success ? r.data : null;
}
