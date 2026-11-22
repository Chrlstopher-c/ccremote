// Responsabilité : poignée de main d'un canal chiffré de bout en bout entre deux membres (initiateur → répondeur).
//
// Schéma : Noise « IK » simplifié. L'initiateur connaît déjà l'identité statique du répondeur (appairage accepté).
//   1. initiateur → répondeur : canal, identité I, éphémère eI, signature Ed25519 de I sur (canal, I, R, eI).
//   2. répondeur → initiateur : éphémère eR, signature Ed25519 de R sur (canal, I, R, eI, eR).
//   Secret : IKM = ee ‖ es ‖ se ‖ ss, avec ee = DH(eI, eR), es = DH(eI, sR), se = DH(sI, eR), ss = DH(sI, sR).
//   Clés : HKDF-SHA256(IKM, sel = SHA-256(canal, I, R, eI, eR), info « i>r » ou « r>i ») : une clé AES-256 par sens.
// Pourquoi :
//   - les éphémères apportent la confidentialité persistante, à condition d'être effacés après la poignée ;
//   - les échanges statiques lient le secret aux identités : sans sR ni sI, un intermédiaire n'obtient aucune clé ;
//   - la signature éphémère prouve la possession de l'identité ; la transcription (canal, identités, éphémères)
//     lie chaque message à ce canal précis : rejeu vers un autre canal, substitution d'identité ou d'éphémère,
//     réponse d'une autre poignée, usurpation du répondeur : tout échoue ;
//   - éphémères neufs et clés par sens à chaque poignée : deux canaux ne partagent jamais de clés.
// Limite : pas de message de confirmation dédié ; la première trame chiffrée du répondeur confirme les clés.
import { ErreurChiffrement } from './erreur.ts';
import { concatener, depuisBase64url, enOctets, type Octets, transcription, versBase64url } from './octets.ts';
import { genererPaireDh, hkdf, importerPubliqueSignature, type PaireDh, secretDh, sha256 } from './cles.ts';
import { champTexte, estObjet } from './lecture.ts';
import { type Canal, creerCanal, importerCleAes } from './messages.ts';
import {
  exporterIdentitePublique,
  importerIdentitePublique,
  type Identite,
  type IdentitePublique,
  octetsIdentite,
} from './identite.ts';

const VERSION = 1;
const TAILLE_CLE_DH = 32;
const TAILLE_SIGNATURE = 64;
const LABEL_INITIAL = enOctets('lanterne-chiffrement/v1/initial');
const LABEL_REPONSE = enOctets('lanterne-chiffrement/v1/reponse');
const LABEL_CLES = enOctets('lanterne-chiffrement/v1/cles');
const INFO_IR = enOctets('lanterne-chiffrement/v1/i>r');
const INFO_RI = enOctets('lanterne-chiffrement/v1/r>i');

export interface MessageInitial {
  readonly version: typeof VERSION;
  readonly canal: string;
  readonly identite: string;
  readonly ephemere: string;
  readonly signature: string;
}

export interface MessageReponse {
  readonly ephemere: string;
  readonly signature: string;
}

/** État gardé par l'initiateur entre son message et la réponse du répondeur. */
export interface AttentePoignee {
  readonly canal: string;
  readonly moi: Identite;
  readonly destinataire: IdentitePublique;
  readonly ephemere: CryptoKey;
  readonly ephemerePublique: Uint8Array<ArrayBuffer>;
}

interface Contexte {
  readonly canal: string;
  readonly idI: IdentitePublique;
  readonly idR: IdentitePublique;
  readonly eI: Octets;
  readonly eR?: Octets;
}

/** Transcription de la poignée : chaque élément à longueur préfixée, le libellé distingue les usages. */
function contexte(libelle: Octets, c: Contexte): Uint8Array<ArrayBuffer> {
  const reponse = c.eR === undefined ? [] : [c.eR];
  return transcription(libelle, enOctets(c.canal), octetsIdentite(c.idI), octetsIdentite(c.idR), c.eI, ...reponse);
}

async function signer(cle: CryptoKey, donnees: Octets): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.sign('Ed25519', cle, donnees));
}

async function verifier(cle: Octets, signature: Octets, donnees: Octets): Promise<void> {
  const publique = await importerPubliqueSignature(cle);
  const valide = await crypto.subtle.verify('Ed25519', publique, signature, donnees);
  if (!valide) throw new ErreurChiffrement('signature de poignée fausse');
}

async function clesDeSession(
  ikm: Octets,
  c: Contexte,
): Promise<{ ir: CryptoKey; ri: CryptoKey }> {
  const sel = await sha256(contexte(LABEL_CLES, c));
  const ir = await hkdf(ikm, sel, INFO_IR);
  const ri = await hkdf(ikm, sel, INFO_RI);
  return { ir: await importerCleAes(ir), ri: await importerCleAes(ri) };
}

function lireChamps(brut: unknown): Record<string, unknown> {
  if (!estObjet(brut)) throw new ErreurChiffrement('poignée : message non objet');
  return brut;
}

export function lireMessageInitial(brut: unknown): MessageInitial {
  const champs = lireChamps(brut);
  if (champs.version !== VERSION) throw new ErreurChiffrement('poignée : version non reconnue');
  return {
    version: VERSION,
    canal: champTexte(champs, 'canal'),
    identite: champTexte(champs, 'identite'),
    ephemere: champTexte(champs, 'ephemere'),
    signature: champTexte(champs, 'signature'),
  };
}

export function lireMessageReponse(brut: unknown): MessageReponse {
  const champs = lireChamps(brut);
  return { ephemere: champTexte(champs, 'ephemere'), signature: champTexte(champs, 'signature') };
}

/** Premier message de l'initiateur, et l'état à garder pour la réponse. */
// L'éphémère n'est fourni que par les vecteurs croisés (graines fixées) ; la production le tire au hasard.
export async function initierPoignee(
  moi: Identite,
  destinataire: IdentitePublique,
  canal: string,
  fixe?: PaireDh,
): Promise<{ message: MessageInitial; attente: AttentePoignee }> {
  const ephemere = fixe ?? (await genererPaireDh(false));
  const signature = await signer(
    moi.signaturePrivee,
    contexte(LABEL_INITIAL, { canal, idI: moi.publique, idR: destinataire, eI: ephemere.publique }),
  );
  const message: MessageInitial = {
    version: VERSION,
    canal,
    identite: exporterIdentitePublique(moi.publique),
    ephemere: versBase64url(ephemere.publique),
    signature: versBase64url(signature),
  };
  const attente: AttentePoignee = {
    canal,
    moi,
    destinataire,
    ephemere: ephemere.privee,
    ephemerePublique: ephemere.publique,
  };
  return { message, attente };
}

/** Répondeur : vérifie le premier message (identité acceptée, signature, canal) puis répond. */
export async function repondrePoignee(
  moi: Identite,
  brut: unknown,
  accepte: (identite: IdentitePublique) => boolean | Promise<boolean>,
  fixe?: PaireDh,
): Promise<{ reponse: MessageReponse; canal: Canal }> {
  const message = lireMessageInitial(brut);
  const idI = await importerIdentitePublique(message.identite);
  if (!(await accepte(idI))) throw new ErreurChiffrement('identité inconnue : poignée refusée');
  const eI = depuisBase64url(message.ephemere, TAILLE_CLE_DH);
  const sigI = depuisBase64url(message.signature, TAILLE_SIGNATURE);
  await verifier(idI.signature, sigI, contexte(LABEL_INITIAL, { canal: message.canal, idI, idR: moi.publique, eI }));
  const eR = fixe ?? (await genererPaireDh(false));
  const c: Contexte = { canal: message.canal, idI, idR: moi.publique, eI, eR: eR.publique };
  const ikm = concatener(
    await secretDh(eR.privee, eI),
    await secretDh(moi.dhPrivee, eI),
    await secretDh(eR.privee, idI.dh),
    await secretDh(moi.dhPrivee, idI.dh),
  );
  const { ir, ri } = await clesDeSession(ikm, c);
  const signature = await signer(moi.signaturePrivee, contexte(LABEL_REPONSE, c));
  const reponse: MessageReponse = { ephemere: versBase64url(eR.publique), signature: versBase64url(signature) };
  const canal = creerCanal({ nom: message.canal, cleEnvoi: ri, sensEnvoi: 2, cleReception: ir, sensReception: 1 });
  return { reponse, canal };
}

/** Initiateur : vérifie la réponse signée par l'identité attendue, puis dérive le canal. */
export async function terminerPoignee(attente: AttentePoignee, brut: unknown): Promise<Canal> {
  const reponse = lireMessageReponse(brut);
  const eR = depuisBase64url(reponse.ephemere, TAILLE_CLE_DH);
  const sigR = depuisBase64url(reponse.signature, TAILLE_SIGNATURE);
  const c: Contexte = {
    canal: attente.canal,
    idI: attente.moi.publique,
    idR: attente.destinataire,
    eI: attente.ephemerePublique,
    eR,
  };
  await verifier(attente.destinataire.signature, sigR, contexte(LABEL_REPONSE, c));
  const ikm = concatener(
    await secretDh(attente.ephemere, eR),
    await secretDh(attente.ephemere, attente.destinataire.dh),
    await secretDh(attente.moi.dhPrivee, eR),
    await secretDh(attente.moi.dhPrivee, attente.destinataire.dh),
  );
  const { ir, ri } = await clesDeSession(ikm, c);
  return creerCanal({ nom: attente.canal, cleEnvoi: ir, sensEnvoi: 1, cleReception: ri, sensReception: 2 });
}
