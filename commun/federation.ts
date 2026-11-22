// Responsabilité : le protocole de la fédération « mes machines » (contrat v2, étape 3) — messages en clair de
// l'appairage entre nœuds, puis messages chiffrés de bout en bout une fois le canal établi. Aucune logique ici.
import { z } from 'zod';
import { TAILLE_MAX_TEXTE_SESSION } from './fichiers-session.ts';
import { Evenement, Projet, ResumeSession } from './session.ts';

/** Taille maximale d'un message en clair (avant chiffrement) : la charge de l'aiguilleur est plafonnée à 1 Mio. */
export const TAILLE_MAX_CLAIR_OCTETS = 600_000;
/** Événements du fil renvoyés pour une session distante (le plus récent en dernier). */
export const TAILLE_FIL_FEDERE = 200;
/** Sessions annoncées par un nœud dans un instantané. */
export const NOMBRE_MAX_SESSIONS_FEDEREES = 150;
/** Abonnements au fil en direct qu'un pair peut tenir ouverts sur un nœud. */
export const NOMBRE_MAX_ABONNEMENTS = 64;
/** Délai d'une demande entre nœuds sans réponse : au-delà, le canal est coupé. */
export const DELAI_REPONSE_FEDEREE_MS = 10_000;

const IDENTITE = /^[A-Za-z0-9_-]{86}$/;
const NOM = z.string().trim().min(1).max(80);
const SESSION = z.string().min(1).max(200);
const REF = z.string().min(1).max(64);
const TEXTE = z.string().min(1).max(TAILLE_MAX_TEXTE_SESSION);

export const IdentitePubliqueTexte = z.string().regex(IDENTITE);

/** En clair : l'appairage (présentation, décision) et l'enveloppe du chiffrement (poignée, trame). */
export const MessageEnClair = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('presentation'), identite: IdentitePubliqueTexte, nom: NOM }),
  z.strictObject({ t: z.literal('accord') }),
  z.strictObject({ t: z.literal('refus'), raison: z.string().max(200) }),
  z.strictObject({ t: z.literal('poignee'), m: z.unknown() }),
  z.strictObject({ t: z.literal('poignee-reponse'), m: z.unknown() }),
  z.strictObject({ t: z.literal('chiffre'), trame: z.string().min(1).max(1_000_000) }),
]);
export type MessageEnClair = z.infer<typeof MessageEnClair>;

// `seq` : numéro de l'événement chez le nœud qui tient la session (absent : nœud d'avant le relais des gestes).
const EvenementFede = z.object({ seq: z.number().int().nonnegative().optional(), ts: z.string(), evt: Evenement });

/** La machine du nœud telle qu'il l'annonce : de quoi la ranger et y créer une session chez ses pairs. */
export const MachineAnnoncee = z.strictObject({
  description: z.string().max(200),
  racines: z.array(z.string().max(4096)).max(50),
  projets: z.array(Projet).max(500),
  comptes: z.array(z.string().max(200)).max(20),
});
export type MachineAnnoncee = z.infer<typeof MachineAnnoncee>;

/**
 * Gestes relayés vers le nœud qui tient la session : le suffixe de route `/api/sessions/:id/<geste>` (ou `ouvrir`
 * pour `POST /api/sessions`), exécuté là-bas par sa propre route, comme un geste local. Liste fermée.
 */
export const GESTES_FEDERES = [
  'ouvrir',
  'evenements',
  'contexte',
  'connecteurs',
  'taches',
  'chapitres',
  'messages',
  'repondre',
  'mode',
  'modele',
  'effort',
  'rapide',
  'autonomie',
  'renommer',
  'interrompre',
  'compacter',
  'reprendre',
  'archiver',
  'desarchiver',
  'epingler',
  'desepingler',
  'marquer_lue',
  'marquer_non_lue',
] as const;
export type GesteFedere = (typeof GESTES_FEDERES)[number];

/** Chiffré de bout en bout : tout ce qui concerne les sessions d'un nœud. */
export const MessageChiffre = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('instantane'),
    machine: NOM,
    nom: NOM,
    sessions: z.array(ResumeSession).max(NOMBRE_MAX_SESSIONS_FEDEREES),
    vue: MachineAnnoncee.optional(),
  }),
  z.strictObject({
    t: z.literal('evenement'),
    session: SESSION,
    seq: z.number().int().nonnegative().optional(),
    ts: z.string(),
    evt: Evenement,
  }),
  z.strictObject({ t: z.literal('fil'), ref: REF, session: SESSION }),
  z.strictObject({
    t: z.literal('fil_reponse'),
    ref: REF,
    session: SESSION,
    evenements: z.array(EvenementFede).max(TAILLE_FIL_FEDERE),
  }),
  z.strictObject({ t: z.literal('ecrire'), ref: REF, session: SESSION, texte: TEXTE }),
  z.strictObject({ t: z.literal('interrompre'), ref: REF, session: SESSION }),
  z.strictObject({
    t: z.literal('ouvrir'),
    ref: REF,
    machine: NOM,
    chemin: z.string().min(1).max(4096),
    message: TEXTE,
  }),
  z.strictObject({
    t: z.literal('reponse'),
    ref: REF,
    ok: z.boolean(),
    raison: z.string().max(300).optional(),
    session: SESSION.optional(),
  }),
  z.strictObject({ t: z.literal('revocation') }),
  z.strictObject({
    t: z.literal('geste'),
    ref: REF,
    geste: z.enum(GESTES_FEDERES),
    methode: z.enum(['GET', 'POST']),
    session: SESSION.optional(),
    requete: z.string().max(2000).optional(),
    corps: z.string().max(TAILLE_MAX_CLAIR_OCTETS).optional(),
  }),
  z.strictObject({
    t: z.literal('geste_reponse'),
    ref: REF,
    statut: z.number().int().min(100).max(599),
    corps: z.string().max(TAILLE_MAX_CLAIR_OCTETS),
  }),
  // Synchronisation sur demande : le contenu est validé par le service synchro (commun/synchro.ts), pas ici.
  z.strictObject({ t: z.literal('synchro'), m: z.unknown() }),
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
