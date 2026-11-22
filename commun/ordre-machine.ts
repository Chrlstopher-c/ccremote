// Responsabilité : l'ordre signé d'un chef vers une machine (téléphone) — format, signature Ed25519 avec la clé
// du signataire lue dans la charte, fraîcheur (2 min), anti-rejeu (nonces gardés 5 min). Fonctions pures : ni E/S,
// ni horloge ici (l'instant est passé par l'appelant).
import { z } from 'zod';
import { type Charte, membreDe } from './charte.ts';
import { importerPubliqueSignature } from './chiffrement/cles.ts';
import { importerIdentitePublique } from './chiffrement/identite.ts';
import { depuisBase64url, enOctets, type Octets, versBase64url } from './chiffrement/octets.ts';
import { OrdreSigne } from './federation.ts';

export { OrdreSigne };

export const PREFIXE_ORDRE = 'lanterne-ordre-v1\n';
export const ACTIONS_ORDRE = ['arreter', 'pause', 'reprendre', 'redemarrer', 'reveiller'] as const;
const ID = z.string().regex(/^[a-f0-9]{12}$/);
const DELAI_ORDRE_MS = 120_000;
const DUREE_NONCE_MS = 300_000;
const TAILLE_SIGNATURE = 64;

export const OrdreMachine = z.strictObject({
  format: z.literal(1),
  reseau: ID,
  cible: ID,
  action: z.enum(ACTIONS_ORDRE),
  par: ID,
  le: z.string().max(40).refine((texte) => !Number.isNaN(Date.parse(texte)), 'date invalide'),
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
});
export type OrdreMachine = z.infer<typeof OrdreMachine>;

export type MotifOrdre = 'illisible' | 'autre-reseau' | 'cible' | 'non-chef' | 'signature' | 'perime' | 'rejoue';
export type VerdictOrdre = { ok: true; ordre: OrdreMachine } | { ok: false; motif: MotifOrdre };

export interface AttenduOrdre {
  readonly cible: string;
  readonly maintenantMs: number;
  readonly nonces: NoncesVus;
}

/** Nonces déjà acceptés, gardés `dureeMs` (au-delà, un ordre est périmé). En mémoire, par nœud. */
export class NoncesVus {
  private readonly expirations = new Map<string, number>();

  constructor(private readonly dureeMs = DUREE_NONCE_MS) {}

  vu(nonce: string, maintenantMs: number): boolean {
    this.purger(maintenantMs);
    return this.expirations.has(nonce);
  }

  noter(nonce: string, maintenantMs: number): void {
    this.purger(maintenantMs);
    this.expirations.set(nonce, maintenantMs + this.dureeMs);
  }

  private purger(maintenantMs: number): void {
    for (const [nonce, fin] of this.expirations) if (fin <= maintenantMs) this.expirations.delete(nonce);
  }
}

function octetsOrdre(texte: string): Octets {
  return enOctets(PREFIXE_ORDRE + texte);
}

export async function signerOrdre(ordre: OrdreMachine, signaturePrivee: CryptoKey): Promise<OrdreSigne> {
  const texte = JSON.stringify(ordre);
  const signature = await crypto.subtle.sign('Ed25519', signaturePrivee, octetsOrdre(texte));
  return { texte, signature: versBase64url(new Uint8Array(signature)) };
}

function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return undefined;
  }
}

function lireOrdre(texte: string): OrdreMachine | null {
  const lu = OrdreMachine.safeParse(lireJson(texte));
  return lu.success ? lu.data : null;
}

async function signatureValide(identite: string, signature: string, texte: string): Promise<boolean> {
  try {
    const publique = await importerIdentitePublique(identite);
    const cle = await importerPubliqueSignature(publique.signature);
    const octets = depuisBase64url(signature, TAILLE_SIGNATURE);
    return await crypto.subtle.verify('Ed25519', cle, octets, octetsOrdre(texte));
  } catch {
    return false;
  }
}

function refus(motif: MotifOrdre): VerdictOrdre {
  return { ok: false, motif };
}

/** Vérifie un ordre contre la charte du nœud visé ; un ordre accepté marque son nonce comme vu. */
export async function verifierOrdre(
  charte: Charte | null,
  signe: OrdreSigne,
  attendu: AttenduOrdre,
): Promise<VerdictOrdre> {
  if (charte === null) return refus('non-chef');
  const ordre = lireOrdre(signe.texte);
  if (ordre === null) return refus('illisible');
  if (ordre.reseau !== charte.reseau) return refus('autre-reseau');
  if (ordre.cible !== attendu.cible) return refus('cible');
  const signataire = membreDe(charte, ordre.par);
  if (signataire === null || !charte.chefs.includes(ordre.par)) return refus('non-chef');
  if (!(await signatureValide(signataire.identite, signe.signature, signe.texte))) return refus('signature');
  if (Math.abs(attendu.maintenantMs - Date.parse(ordre.le)) > DELAI_ORDRE_MS) return refus('perime');
  if (attendu.nonces.vu(ordre.nonce, attendu.maintenantMs)) return refus('rejoue');
  attendu.nonces.noter(ordre.nonce, attendu.maintenantMs);
  return { ok: true, ordre };
}
