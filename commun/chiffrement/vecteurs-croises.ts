// Responsabilité : vecteurs croisés Bun ↔ Swift du chiffrement de bout en bout. Identités, poignée et trames
// à graines fixées ; le JSON produit est relu octet pour octet par les tests Swift (noyau Vigie, dossier Aiguilleur).
// Graines de test publiques : jamais une identité réelle.
// Usage : bun run commun/chiffrement/vecteurs-croises.ts [fichier de sortie]
import { writeFileSync } from 'node:fs';
import { type PaireDh } from './cles.ts';
import { exporterIdentitePublique, type Identite } from './identite.ts';
import { depuisBase64url, type Octets, versBase64url } from './octets.ts';
import { initierPoignee, repondrePoignee, terminerPoignee } from './poignee.ts';
import type { Canal } from './messages.ts';

const PKCS8_X25519 = '302e020100300506032b656e04220420';
const PKCS8_ED25519 = '302e020100300506032b657004220420';
const CANAL = 'vecteur-1';

const GRAINES = {
  identiteI: {
    dh: '01'.repeat(32),
    signature: '11'.repeat(32),
  },
  identiteR: {
    dh: '02'.repeat(32),
    signature: '22'.repeat(32),
  },
  ephemereI: '03'.repeat(32),
  ephemereR: '04'.repeat(32),
};

const CLAIRS_I_R = ['bonjour', '', 'donnée ✓ accents éà'];
const CLAIRS_R_I = ['réponse 1', '{"t":"api"}'];

const hexVers = (o: Octets): string => Buffer.from(o).toString('hex');
const depuisHex = (texte: string): Octets => new Uint8Array(Buffer.from(texte, 'hex'));
const octetsTexte = (texte: string): Octets => new TextEncoder().encode(texte);
const lisible = (o: Octets): string => new TextDecoder().decode(o);

type UsagesCle = Parameters<SubtleCrypto['importKey']>[4];

async function cleSeedee(
  prefixe: string,
  graine: string,
  nom: 'X25519' | 'Ed25519',
  usages: UsagesCle,
): Promise<CryptoKey> {
  const pkcs8 = depuisHex(prefixe + graine);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: nom }, true, usages);
}

async function clePublique(cle: CryptoKey): Promise<Octets> {
  const jwk = await crypto.subtle.exportKey('jwk', cle);
  if (typeof jwk.x !== 'string') throw new Error('jwk sans x : export refusé');
  return depuisBase64url(jwk.x, 32);
}

async function identiteDeGraines(graines: { dh: string; signature: string }): Promise<Identite> {
  const dhPrivee = await cleSeedee(PKCS8_X25519, graines.dh, 'X25519', ['deriveBits']);
  const signaturePrivee = await cleSeedee(PKCS8_ED25519, graines.signature, 'Ed25519', ['sign']);
  const publique = { dh: await clePublique(dhPrivee), signature: await clePublique(signaturePrivee) };
  return { publique, dhPrivee, signaturePrivee };
}

async function paireDeGraine(graine: string): Promise<PaireDh> {
  const privee = await cleSeedee(PKCS8_X25519, graine, 'X25519', ['deriveBits']);
  return { privee, publique: await clePublique(privee) };
}

function trameDecrite(sens: 'i>r' | 'r>i', clair: string, trame: Octets): Record<string, string> {
  return { sens, clair: hexVers(octetsTexte(clair)), trame: hexVers(trame) };
}

async function trames(
  envoyeur: Canal,
  recepteur: Canal,
  sens: 'i>r' | 'r>i',
  clairs: readonly string[],
): Promise<Record<string, string>[]> {
  const sortie: Record<string, string>[] = [];
  for (const clair of clairs) {
    const trame = await envoyeur.chiffrer(octetsTexte(clair));
    const relu = await recepteur.dechiffrer(trame);
    if (lisible(relu) !== clair) throw new Error(`trame ${sens} : aller-retour faux`);
    sortie.push(trameDecrite(sens, clair, trame));
  }
  return sortie;
}

/** Produit l'ensemble des vecteurs ; chaque sortie est validée par un aller-retour avant d'être rendue. */
export async function produireVecteurs(): Promise<Record<string, unknown>> {
  const I = await identiteDeGraines(GRAINES.identiteI);
  const R = await identiteDeGraines(GRAINES.identiteR);
  const eI = await paireDeGraine(GRAINES.ephemereI);
  const eR = await paireDeGraine(GRAINES.ephemereR);
  const cleI = exporterIdentitePublique(I.publique);
  const { message, attente } = await initierPoignee(I, R.publique, CANAL, eI);
  const accepte = (id: Identite['publique']): boolean => exporterIdentitePublique(id) === cleI;
  const { reponse, canal: canalR } = await repondrePoignee(R, message, accepte, eR);
  const canalI = await terminerPoignee(attente, reponse);
  const trameIR = await trames(canalI, canalR, 'i>r', CLAIRS_I_R);
  const trameRI = await trames(canalR, canalI, 'r>i', CLAIRS_R_I);
  return {
    version: 1,
    identites: {
      I: { graineDh: GRAINES.identiteI.dh, graineSignature: GRAINES.identiteI.signature, publique: cleI },
      R: {
        graineDh: GRAINES.identiteR.dh,
        graineSignature: GRAINES.identiteR.signature,
        publique: exporterIdentitePublique(R.publique),
      },
    },
    poignee: {
      canal: CANAL,
      ephemereI: { graine: GRAINES.ephemereI, publique: versBase64url(eI.publique) },
      ephemereR: { graine: GRAINES.ephemereR, publique: versBase64url(eR.publique) },
      messageInitial: message,
      messageReponse: reponse,
    },
    canal: { trames: [...trameIR, ...trameRI] },
  };
}

if (import.meta.main) {
  const sortie = process.argv[2] ?? `${import.meta.dir}/vecteurs-croises.json`;
  writeFileSync(sortie, `${JSON.stringify(await produireVecteurs(), null, 2)}\n`);
  console.log(`vecteurs écrits : ${sortie}`);
}
