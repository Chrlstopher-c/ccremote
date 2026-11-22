// Responsabilité : canal chiffré après poignée — AES-256-GCM, un compteur par sens, trame = compteur ‖ chiffré.
// Garanties : refus du rejeu, de la réordination, de la troncature, de l'altération et de la réflexion (une trame
// renvoyée à son émetteur est refusée : les clés diffèrent par sens). Le canal suppose un transport ordonné
// (WebSocket, TCP) : une trame refusée ou perdue rend le canal inutilisable, il faut en ouvrir un autre.
import { ErreurChiffrement } from './erreur.ts';
import { concatener, compteurOctets, enOctets, lireCompteur, type Octets, TAILLE_COMPTEUR } from './octets.ts';

/** 1 = initiateur → répondeur, 2 = répondeur → initiateur. */
export type CodeSens = 1 | 2;

export interface Canal {
  chiffrer(clair: Octets): Promise<Octets>;
  dechiffrer(trame: Octets): Promise<Octets>;
}

export interface ParametresCanal {
  readonly nom: string;
  readonly cleEnvoi: CryptoKey;
  readonly sensEnvoi: CodeSens;
  readonly cleReception: CryptoKey;
  readonly sensReception: CodeSens;
}

interface EtatCanal {
  envoi: number;
  attendu: number;
}

const TAILLE_ETIQUETTE = 16;
const TAILLE_NONCE = 12;
const LIMITE_COMPTEUR = Number.MAX_SAFE_INTEGER;

/** Nonce de 96 bits : quatre octets nuls puis le compteur. Un compteur ne se répète jamais sur une clé. */
function nonce(entete: Octets): Octets {
  return concatener(new Uint8Array(TAILLE_NONCE - TAILLE_COMPTEUR), entete);
}

/** Données associées : nom du canal, sens de la trame, compteur. */
function donneesAssociees(nom: Octets, sens: CodeSens, entete: Octets): Octets {
  return concatener(nom, Uint8Array.of(sens), entete);
}

export async function importerCleAes(octets: Octets): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', octets, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function chiffrerTrame(p: ParametresCanal, nom: Octets, etat: EtatCanal, clair: Octets): Promise<Octets> {
  if (etat.envoi >= LIMITE_COMPTEUR) throw new ErreurChiffrement('canal épuisé : ouvrir une nouvelle poignée');
  const entete = compteurOctets(etat.envoi);
  etat.envoi += 1;
  try {
    const chiffre = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce(entete),
        additionalData: donneesAssociees(nom, p.sensEnvoi, entete),
        tagLength: TAILLE_ETIQUETTE * 8,
      },
      p.cleEnvoi,
      clair,
    );
    return concatener(entete, new Uint8Array(chiffre));
  } catch (cause) {
    throw new ErreurChiffrement(`chiffrement refusé : ${String(cause)}`);
  }
}

async function dechiffrerTrame(p: ParametresCanal, nom: Octets, etat: EtatCanal, trame: Octets): Promise<Octets> {
  if (trame.length < TAILLE_COMPTEUR + TAILLE_ETIQUETTE) throw new ErreurChiffrement('trame tronquée');
  const recu = lireCompteur(trame);
  if (recu < etat.attendu) throw new ErreurChiffrement('trame rejouée refusée');
  if (recu > etat.attendu) throw new ErreurChiffrement('trame réordonnée ou manquante : refusée');
  etat.attendu += 1;
  const entete = trame.slice(0, TAILLE_COMPTEUR);
  try {
    const clair = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce(entete),
        additionalData: donneesAssociees(nom, p.sensReception, entete),
        tagLength: TAILLE_ETIQUETTE * 8,
      },
      p.cleReception,
      trame.slice(TAILLE_COMPTEUR),
    );
    return new Uint8Array(clair);
  } catch {
    throw new ErreurChiffrement('trame altérée : authentification échouée');
  }
}

export function creerCanal(parametres: ParametresCanal): Canal {
  const nom = enOctets(parametres.nom);
  const etat: EtatCanal = { envoi: 0, attendu: 0 };
  return {
    chiffrer: (clair) => chiffrerTrame(parametres, nom, etat, clair),
    dechiffrer: (trame) => dechiffrerTrame(parametres, nom, etat, trame),
  };
}
