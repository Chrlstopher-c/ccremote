// Responsabilité : la présentation mutuelle de deux nœuds sur une liaison directe — chacun prouve qu'il détient la clé
// de l'identité qu'il annonce, par une signature Ed25519 sur un défi frais du pair. Ce module ne décide de rien : il
// rend l'identité prouvée ; le nœud décide ensuite (pair connu, appairage, refus).
import { z } from 'zod';
import { importerPubliqueSignature, sha256 } from '../../commun/chiffrement/cles.ts';
import {
  exporterIdentitePublique,
  importerIdentitePublique,
  type Identite,
  type IdentitePublique,
  octetsIdentite,
} from '../../commun/chiffrement/identite.ts';
import {
  depuisBase64url,
  enOctets,
  type Octets,
  transcription,
  versBase64url,
} from '../../commun/chiffrement/octets.ts';

const IDENTIFIANT = /^[a-f0-9]{12}$/;
const DEFI = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const IDENTITE = /^[A-Za-z0-9_-]{86}$/;

const Defi = z.strictObject({ t: z.literal('defi'), nonce: z.string().regex(DEFI) });
const Bonjour = z.strictObject({
  t: z.literal('bonjour'),
  de: z.string().regex(IDENTIFIANT),
  identite: z.string().regex(IDENTITE),
  nom: z.string().min(1).max(80),
  proprietaire: z.string().min(1).max(40).optional(),
  defi: z.string().regex(DEFI),
  signature: z.string().regex(SIGNATURE),
});
const Accueil = z.strictObject({
  t: z.literal('accueil'),
  de: z.string().regex(IDENTIFIANT),
  identite: z.string().regex(IDENTITE),
  nom: z.string().min(1).max(80),
  proprietaire: z.string().min(1).max(40).optional(),
  signature: z.string().regex(SIGNATURE),
});

export type MessageDefi = z.infer<typeof Defi>;
export type MessageBonjour = z.infer<typeof Bonjour>;
export type MessageAccueil = z.infer<typeof Accueil>;

/** Ce que le nœud local dit de lui-même sur la liaison. */
export interface Locale {
  readonly id: string;
  readonly identite: Identite;
  readonly nom: string;
  readonly proprietaire: string | null;
}

/** Un pair dont l'identité vient d'être prouvée sur la liaison. */
export interface PresentationDirecte {
  readonly id: string;
  readonly identite: IdentitePublique;
  readonly nom: string;
  readonly proprietaire: string | undefined;
}

const LIBELLE_BONJOUR = enOctets('lanterne-directe/bonjour');
const LIBELLE_ACCUEIL = enOctets('lanterne-directe/accueil');

/** Un défi frais : 32 octets aléatoires. */
export function defiAleatoire(): string {
  return versBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function messageDefi(nonce: string): MessageDefi {
  return { t: 'defi', nonce };
}

export function lireDefi(brut: unknown): string | null {
  const r = Defi.safeParse(brut);
  return r.success ? r.data.nonce : null;
}

function contenuBonjour(defiServeur: string, de: string, identite: IdentitePublique, defiClient: string): Octets {
  return transcription(
    LIBELLE_BONJOUR,
    enOctets(defiServeur),
    enOctets(de),
    octetsIdentite(identite),
    enOctets(defiClient),
  );
}

function contenuAccueil(defiClient: string, de: string, identite: IdentitePublique): Octets {
  return transcription(LIBELLE_ACCUEIL, enOctets(defiClient), enOctets(de), octetsIdentite(identite));
}

async function signer(identite: Identite, donnees: Octets): Promise<string> {
  const signature = await crypto.subtle.sign('Ed25519', identite.signaturePrivee, donnees);
  return versBase64url(new Uint8Array(signature));
}

async function verifier(identite: IdentitePublique, signature: string, donnees: Octets): Promise<boolean> {
  const cle = await importerPubliqueSignature(identite.signature);
  return crypto.subtle.verify('Ed25519', cle, depuisBase64url(signature, 64), donnees);
}

/** Message de l'initiateur : il répond au défi du répondeur et lui envoie le sien. */
export async function composerBonjour(
  moi: Locale,
  defiServeur: string,
  defiClient: string,
): Promise<MessageBonjour> {
  const publique = moi.identite.publique;
  const signature = await signer(moi.identite, contenuBonjour(defiServeur, moi.id, publique, defiClient));
  return {
    t: 'bonjour',
    de: moi.id,
    identite: exporterIdentitePublique(publique),
    nom: moi.nom,
    ...(moi.proprietaire ? { proprietaire: moi.proprietaire } : {}),
    defi: defiClient,
    signature,
  };
}

export interface BonjourVerifie {
  readonly presentation: PresentationDirecte;
  /** Défi de l'initiateur : la réponse doit le signer. */
  readonly defi: string;
}

/** Vérifie le bonjour reçu par le répondeur (qui a envoyé `defiServeur`). Null si mal formé ou signature fausse. */
export async function verifierBonjour(brut: unknown, defiServeur: string): Promise<BonjourVerifie | null> {
  const r = Bonjour.safeParse(brut);
  if (!r.success) return null;
  const m = r.data;
  const identite = await lireIdentite(m.identite);
  if (!identite) return null;
  const valide = await verifier(identite, m.signature, contenuBonjour(defiServeur, m.de, identite, m.defi));
  if (!valide) return null;
  const presentation = { id: m.de, identite, nom: m.nom, proprietaire: m.proprietaire };
  return { presentation, defi: m.defi };
}

/** Réponse du répondeur : il prouve son identité au regard du défi de l'initiateur. */
export async function composerAccueil(moi: Locale, defiClient: string): Promise<MessageAccueil> {
  const publique = moi.identite.publique;
  const signature = await signer(moi.identite, contenuAccueil(defiClient, moi.id, publique));
  return {
    t: 'accueil',
    de: moi.id,
    identite: exporterIdentitePublique(publique),
    nom: moi.nom,
    ...(moi.proprietaire ? { proprietaire: moi.proprietaire } : {}),
    signature,
  };
}

/** Vérifie l'accueil reçu par l'initiateur (qui a envoyé `defiClient`). Null si mal formé ou signature fausse. */
export async function verifierAccueil(brut: unknown, defiClient: string): Promise<PresentationDirecte | null> {
  const r = Accueil.safeParse(brut);
  if (!r.success) return null;
  const m = r.data;
  const identite = await lireIdentite(m.identite);
  if (!identite) return null;
  const valide = await verifier(identite, m.signature, contenuAccueil(defiClient, m.de, identite));
  return valide ? { id: m.de, identite, nom: m.nom, proprietaire: m.proprietaire } : null;
}

async function lireIdentite(texte: string): Promise<IdentitePublique | null> {
  try {
    return await importerIdentitePublique(texte);
  } catch {
    return null;
  }
}

/** Empreinte courte d'un identifiant de nœud dérivé de son identité (sans aiguilleur). */
export async function identifiantDerive(identite: IdentitePublique): Promise<string> {
  const hache = await sha256(octetsIdentite(identite));
  return Array.from(hache.slice(0, 6), (o) => o.toString(16).padStart(2, '0')).join('');
}
