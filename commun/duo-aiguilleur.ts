// Responsabilité : le protocole du duo par l'aiguilleur (contrat v2, étape 7) — préfixe des canaux du duo (le nœud
// les distingue de ceux de la fédération), messages en clair de l'appairage et de l'enveloppe chiffrée, et la preuve
// HMAC qui lie le code d'appairage aux deux identités. Aucune logique de session ici.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { MessageDeAiguilleur, MessageVersAiguilleur } from './aiguilleur.ts';
import type { Identite } from './chiffrement/identite.ts';
import { IdentitePubliqueTexte, TAILLE_MAX_CLAIR_OCTETS } from './federation.ts';

/** Préfixe des identifiants de canal du duo : `[A-Za-z0-9_-]{1,64}`, distinct des canaux de la fédération. */
export const PREFIXE_CANAL_DUO = 'duo-';

/** Taille maximale d'un message en clair du duo (avant chiffrement, poignée comprise). */
export const TAILLE_MAX_CLAIR_DUO = TAILLE_MAX_CLAIR_OCTETS;

const NOM = z.string().trim().min(1).max(80);
const UTILISATEUR = z.string().min(1).max(64);
const PREUVE = z.string().regex(/^[0-9a-f]{64}$/);

/** En clair sur le canal, avant la poignée (appairage, décision) et l'enveloppe de la poignée et des trames. */
export const MessageDuoClair = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('appairage'),
    preuve: PREUVE,
    identite: IdentitePubliqueTexte,
    nom: NOM,
    utilisateur: UTILISATEUR,
  }),
  z.strictObject({ t: z.literal('presentation'), identite: IdentitePubliqueTexte, nom: NOM, utilisateur: UTILISATEUR }),
  z.strictObject({ t: z.literal('accord') }),
  z.strictObject({ t: z.literal('refus'), raison: z.string().max(200) }),
  z.strictObject({ t: z.literal('poignee'), m: z.unknown() }),
  z.strictObject({ t: z.literal('poignee-reponse'), m: z.unknown() }),
  z.strictObject({ t: z.literal('chiffre'), trame: z.string().min(1).max(1_000_000) }),
]);
export type MessageDuoClair = z.infer<typeof MessageDuoClair>;
export type Presentation = Extract<MessageDuoClair, { t: 'presentation' }>;
export type Appairage = Extract<MessageDuoClair, { t: 'appairage' }>;

/** Lit un message en clair reçu (null s'il n'est pas du protocole du duo). */
export function lireMessageDuoClair(brut: unknown): MessageDuoClair | null {
  const r = MessageDuoClair.safeParse(brut);
  return r.success ? r.data : null;
}

/** Identifiant neuf d'un canal du duo. */
export function nonceCanalDuo(): string {
  return `${PREFIXE_CANAL_DUO}${randomBytes(8).toString('hex')}`;
}

export function estCanalDuo(canal: string): boolean {
  return canal.startsWith(PREFIXE_CANAL_DUO);
}

/** Ce que le duo demande au lien de l'aiguilleur ; fourni par la fédération du nœud, qui en garde le seul lien. */
export interface PortAiguilleurDuo {
  membreLocal(): string | null;
  identiteLocale(): Promise<Identite>;
  envoyer(message: MessageVersAiguilleur): boolean;
  enLigne(membre: string): boolean;
  relie(): boolean;
}

/** Ce que la fédération transmet au duo : les messages de ses canaux (préfixe `duo-`) et la vie du lien. */
export interface HandlerDuoAiguilleur {
  surMessage(message: MessageDeAiguilleur): void;
  surConnexion(connecte: boolean): void;
}

/** Un message de l'aiguilleur concerne-t-il un canal du duo (et non un canal de la fédération) ? */
export function concerneDuo(message: MessageDeAiguilleur): boolean {
  if (message.t === 'presence') return false;
  return 'canal' in message && estCanalDuo(message.canal ?? '');
}

/**
 * Preuve que le demandeur connaît le code : HMAC du code sur (nœud visé, nœud demandeur, identité du demandeur).
 * Lier les trois identifiants empêche de rejouer une preuve vers un autre nœud ou avec une autre identité.
 */
export function preuveAppairage(code: string, visee: string, demandeur: string, identite: string): string {
  const message = `duo-appairage|${visee}|${demandeur}|${identite}`;
  return createHmac('sha256', code.toUpperCase()).update(message).digest('hex');
}

export function preuveAppairageValide(attendue: string, recue: string): boolean {
  const a = Buffer.from(attendue, 'hex');
  const b = Buffer.from(recue, 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
