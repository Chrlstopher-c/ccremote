// Responsabilité : le protocole de l'aiguilleur (contrat v2 du réseau Lanterne) — les messages qu'un membre (nœud ou
// appareil) échange avec l'aiguilleur sur son lien sortant `/aiguilleur`, dans les deux sens. La charge d'un canal est
// une chaîne opaque : l'aiguilleur ne l'interprète ni ne la journalise.
import { z } from 'zod';

/** Genres de membre : un nœud (relais + poste) ou un appareil (iPhone, client). */
export const GENRES_MEMBRE = ['noeud', 'appareil'] as const;
export type GenreMembre = (typeof GENRES_MEMBRE)[number];

/** Nombre maximal de canaux ouverts (dans les deux sens) pour un même membre. */
export const CANAUX_MAX_PAR_MEMBRE = 32;

/** Taille maximale d'une charge, en octets UTF-8. */
export const LIMITE_CHARGE_OCTETS = 1024 * 1024;

/** Taille maximale d'une trame WebSocket (enveloppe JSON comprise) : au-delà, le lien est coupé par le serveur. */
export const TAILLE_MAX_TRAME_OCTETS = 2 * LIMITE_CHARGE_OCTETS;

/** Chemins du protocole : appairage d'un membre (HTTP POST) et lien sortant authentifié (WebSocket). */
export const CHEMIN_APPAIRAGE_MEMBRE = '/api/membres/appairer';
export const CHEMIN_LIEN_AIGUILLEUR = '/aiguilleur';

/** Identifiant d'un membre : 12 caractères hexadécimaux, attribués par l'aiguilleur à l'appairage. */
export const VALIDE_IDENTIFIANT = /^[a-f0-9]{12}$/;

/** Identifiant d'un canal, choisi par l'ouvrant : 1 à 64 caractères sûrs. */
export const VALIDE_CANAL = /^[A-Za-z0-9_-]{1,64}$/;

/** Motifs d'erreur que l'aiguilleur peut renvoyer : liste fermée, sans texte libre ni donnée du canal. */
export const MOTIFS_ERREUR = [
  'message-invalide',
  'non-autorise',
  'hors-ligne',
  'canal-indisponible',
  'canal-inconnu',
  'canal-non-ouvert',
  'trop-de-canaux',
  'charge-trop-grande',
] as const;

export type MotifErreur = (typeof MOTIFS_ERREUR)[number];

const Identifiant = z.string().regex(VALIDE_IDENTIFIANT);
const Canal = z.string().regex(VALIDE_CANAL);

const OuvrirVers = z.strictObject({ t: z.literal('ouvrir'), canal: Canal, vers: Identifiant });
const Donnees = z.strictObject({ t: z.literal('donnees'), canal: Canal, charge: z.string() });
const SurCanal = <T extends string>(t: T) => z.strictObject({ t: z.literal(t), canal: Canal });

const VersAiguilleur = z.discriminatedUnion('t', [
  OuvrirVers,
  Donnees,
  SurCanal('fermer'),
  SurCanal('accepter'),
  SurCanal('refuser'),
]);

const Membre = z.strictObject({ id: Identifiant, enLigne: z.boolean() });

const DeAiguilleur = z.discriminatedUnion('t', [
  z.strictObject({ t: z.literal('ouvrir'), canal: Canal, de: Identifiant }),
  Donnees,
  SurCanal('fermer'),
  SurCanal('accepter'),
  SurCanal('refuser'),
  z.strictObject({ t: z.literal('presence'), membres: z.array(Membre) }),
  z.strictObject({ t: z.literal('erreur'), canal: Canal.optional(), motif: z.enum(MOTIFS_ERREUR) }),
]);

export type MessageVersAiguilleur = z.infer<typeof VersAiguilleur>;
export type MessageDeAiguilleur = z.infer<typeof DeAiguilleur>;
export type MembrePresence = z.infer<typeof Membre>;

/** Un message d'un membre, ou null s'il n'est pas du protocole (type inconnu, champ de trop, format faux). */
export function analyserVersAiguilleur(brut: unknown): MessageVersAiguilleur | null {
  const r = VersAiguilleur.safeParse(brut);
  return r.success ? r.data : null;
}

/** Un message de l'aiguilleur vers un membre, ou null s'il n'est pas du protocole. */
export function analyserDeAiguilleur(brut: unknown): MessageDeAiguilleur | null {
  const r = DeAiguilleur.safeParse(brut);
  return r.success ? r.data : null;
}

/** Taille d'une charge en octets UTF-8 (la limite se mesure en octets, pas en caractères). */
export function octetsCharge(charge: string): number {
  return new TextEncoder().encode(charge).byteLength;
}
