// Responsabilité : les contrats du mode duo (deux relais reliés) — appairage, partage, messages du lien entre relais et
// état vu par les clients. Aucune logique : les décisions sont dans relais/duo/.
import { z } from 'zod';
import { Evenement, ResumeSession } from './session.ts';

export const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L : lisible à la voix
export const LONGUEUR_CODE = 8;
export const DUREE_CODE_MS = 10 * 60 * 1000;
export const ESSAIS_CODE_MAX = 5; // au-delà, le code est brûlé
export const TAILLE_HISTORIQUE_DUO = 200; // événements renvoyés par la relecture d'une session partagée

export const NiveauPartage = z.enum(['lecture', 'ecriture']);
export type NiveauPartage = z.infer<typeof NiveauPartage>;
export const GenrePartage = z.enum(['session', 'projet']);
export type GenrePartage = z.infer<typeof GenrePartage>;

export const CorpsRejoindre = z.object({
  adresse: z.string().min(3).max(255), // hôte:port du relais du pair, tel qu'affiché chez lui
  code: z.string().length(LONGUEUR_CODE),
});
export const CorpsPartage = z.object({
  cible: z.string().min(1).max(2048), // identifiant de session, ou chemin du projet
  genre: GenrePartage,
  niveau: NiveauPartage,
});
export const CorpsPresence = z.object({ session: z.string().min(1).max(200), present: z.boolean() });
export type CorpsRejoindre = z.infer<typeof CorpsRejoindre>;
export type CorpsPartage = z.infer<typeof CorpsPartage>;
export type CorpsPresence = z.infer<typeof CorpsPresence>;

export const PartageDuo = z.object({
  cible: z.string(),
  genre: GenrePartage,
  niveau: NiveauPartage,
  creeLe: z.string(),
});
export type PartageDuo = z.infer<typeof PartageDuo>;

export const EtatDuo = z.object({
  utilisateur: z.string(), // nom de ce relais, annoncé au pair
  pair: z.object({ utilisateur: z.string(), adresse: z.string().nullable() }).nullable(),
  // absent : non appairé · connecte : lien authentifié · hors_ligne : appairé, lien coupé · refuse : clé rejetée
  etat: z.enum(['absent', 'connecte', 'hors_ligne', 'refuse']),
  partages: z.array(PartageDuo),
  presences: z.array(z.string()), // sessions partagées ouvertes chez le pair
});
export type EtatDuo = z.infer<typeof EtatDuo>;

const FicheDuo = z.object({ fiche: ResumeSession, niveau: NiveauPartage });
const Horodate = z.object({ ts: z.string(), evt: Evenement });

// Messages du lien entre relais. Un seul discriminant (`type`) ; le lien ne porte jamais la clé de la paire en clair
// hors de l'appairage (une fois, sous le code à usage unique).
export const MessageLien = z.discriminatedUnion('type', [
  z.object({ type: z.literal('appairage'), code: z.string(), utilisateur: z.string().min(1).max(64) }),
  z.object({ type: z.literal('appairage_ok'), paire: z.string(), cle: z.string(), utilisateur: z.string() }),
  z.object({ type: z.literal('lien'), paire: z.string(), nonce: z.string() }),
  z.object({ type: z.literal('defi'), nonce: z.string(), preuve: z.string() }),
  z.object({ type: z.literal('preuve'), preuve: z.string() }),
  z.object({ type: z.literal('lien_ok'), utilisateur: z.string() }),
  z.object({ type: z.literal('refus'), raison: z.string() }),
  z.object({ type: z.literal('partage'), sessions: z.array(FicheDuo) }),
  FicheDuo.extend({ type: z.literal('fiche') }),
  z.object({ type: z.literal('evenement'), sessionId: z.string(), ...Horodate.shape }),
  z.object({ type: z.literal('historique_demande'), sessionId: z.string() }),
  z.object({
    type: z.literal('historique'),
    sessionId: z.string(),
    evenements: z.array(Horodate).max(TAILLE_HISTORIQUE_DUO),
  }),
  z.object({ type: z.literal('duo_presence'), session: z.string(), present: z.boolean() }),
  z.object({ type: z.literal('revocation') }),
]);
export type MessageLien = z.infer<typeof MessageLien>;
