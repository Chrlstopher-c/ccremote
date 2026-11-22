// Responsabilité : le vocabulaire des synchronisations sur demande entre nœuds (contrat v2, étape 6) — demande,
// décision et paquet, validés à la frontière. Aucune logique ici : le relais décide, applique et journalise.
import { z } from 'zod';
import { ListeCategories } from './categories.ts';
import { ListeGroupesMasques } from './groupes-masques.ts';

export const PERIMETRES_SYNCHRO = ['favoris', 'categories', 'masquees'] as const;
export type PerimetreSynchro = (typeof PERIMETRES_SYNCHRO)[number];
export const Perimetre = z.enum(PERIMETRES_SYNCHRO);

/** Délai d'une demande (reçue ou envoyée) sans décision : au-delà, elle expire et rien ne part. */
export const DELAI_DEMANDE_SYNCHRO_MS = 10 * 60 * 1000;
/** Taille maximale d'un paquet (JSON, octets) : refusé au-delà, à l'envoi comme à la réception. */
export const TAILLE_MAX_PAQUET_OCTETS = 200_000;
/** Identifiants de session cumulés dans un paquet (favoris et sessions des catégories). */
export const NOMBRE_MAX_IDENTIFIANTS_PAQUET = 2000;
/** Demandes entrantes en attente d'une décision, au plus : au-delà, la nouvelle est refusée tout de suite. */
export const NOMBRE_MAX_DEMANDES_SYNCHRO = 10;

const MEMBRE = /^[a-f0-9]{12}$/;
const IDENTIFIANT = z.string().min(1).max(64);
const SESSION = z.string().min(1).max(200);

function sansDoublon(liste: readonly string[]): boolean {
  return new Set(liste).size === liste.length;
}

/** Un périmètre demandé : au moins un, chacun une seule fois. */
export const Quoi = z.array(Perimetre).min(1).max(PERIMETRES_SYNCHRO.length).refine(sansDoublon, {
  message: 'périmètre en double',
});

export const DemandeSynchro = z.strictObject({
  t: z.literal('demande'),
  id: IDENTIFIANT,
  genre: z.literal('synchro'),
  quoi: Quoi,
  de: z.string().regex(MEMBRE),
  vers: z.string().regex(MEMBRE),
  le: z.string().max(64),
});
export type DemandeSynchro = z.infer<typeof DemandeSynchro>;

export const DecisionSynchro = z.strictObject({
  t: z.literal('decision'),
  id: IDENTIFIANT,
  accord: z.boolean(),
  raison: z.string().max(200).optional(),
  expiree: z.boolean().optional(),
});
export type DecisionSynchro = z.infer<typeof DecisionSynchro>;

/** Seuls les champs du périmètre accordé peuvent être présents : le contrôle est fait par `paquetConforme`. */
export const PaquetSynchro = z.strictObject({
  t: z.literal('paquet'),
  id: IDENTIFIANT,
  favoris: z.array(SESSION).max(NOMBRE_MAX_IDENTIFIANTS_PAQUET).optional(),
  categories: ListeCategories.optional(),
  masquees: ListeGroupesMasques.optional(),
});
export type PaquetSynchro = z.infer<typeof PaquetSynchro>;

export const MessageSynchro = z.discriminatedUnion('t', [DemandeSynchro, DecisionSynchro, PaquetSynchro]);
export type MessageSynchro = z.infer<typeof MessageSynchro>;

export type LectureSynchro =
  | { readonly ok: true; readonly message: MessageSynchro }
  | { readonly ok: false; readonly raison: string };

/** Identifiants de session d'un paquet (favoris et sessions de chaque catégorie). */
export function compterIdentifiants(paquet: PaquetSynchro): number {
  const categories = (paquet.categories ?? []).reduce((total, c) => total + c.sessions.length, 0);
  return (paquet.favoris?.length ?? 0) + categories;
}

/** Éléments d'un paquet, comptés comme dans le journal : favoris, catégories, sessions rangées, groupes. */
export function compterElements(paquet: PaquetSynchro): number {
  const categories = paquet.categories ?? [];
  const sessions = categories.reduce((total, c) => total + c.sessions.length, 0);
  return (paquet.favoris?.length ?? 0) + categories.length + sessions + (paquet.masquees?.length ?? 0);
}

export function tailleOctets(message: unknown): number {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

function estPaquet(brut: unknown): boolean {
  return typeof brut === 'object' && brut !== null && 't' in brut && brut.t === 'paquet';
}

/** Lit un message reçu : taille, forme, puis bornes d'un paquet. Refuse tout ce qui n'est pas du protocole. */
export function lireMessageSynchro(brut: unknown): LectureSynchro {
  if (estPaquet(brut) && tailleOctets(brut) > TAILLE_MAX_PAQUET_OCTETS) {
    return { ok: false, raison: 'paquet trop grand' };
  }
  const r = MessageSynchro.safeParse(brut);
  if (!r.success) return { ok: false, raison: 'message synchro invalide' };
  if (r.data.t === 'paquet' && compterIdentifiants(r.data) > NOMBRE_MAX_IDENTIFIANTS_PAQUET) {
    return { ok: false, raison: 'paquet trop grand' };
  }
  return { ok: true, message: r.data };
}

/** Vrai si le paquet porte exactement le périmètre demandé : ni un champ de plus, ni un champ manquant. */
export function paquetConforme(paquet: PaquetSynchro, quoi: readonly PerimetreSynchro[]): boolean {
  const presents: Record<PerimetreSynchro, boolean> = {
    favoris: paquet.favoris !== undefined,
    categories: paquet.categories !== undefined,
    masquees: paquet.masquees !== undefined,
  };
  return PERIMETRES_SYNCHRO.every((p) => presents[p] === quoi.includes(p));
}
