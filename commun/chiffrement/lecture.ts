// Responsabilité : lecture validée de données venues de l'extérieur (JSON non typé), sans cast à l'aveugle.
import { ErreurChiffrement } from './erreur.ts';

export function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null;
}

export function champTexte(objet: Record<string, unknown>, nom: string): string {
  const valeur = objet[nom];
  if (typeof valeur !== 'string') throw new ErreurChiffrement(`champ « ${nom} » absent ou non textuel`);
  return valeur;
}

/** WebCrypto rend une paire pour X25519 et Ed25519 ; son typage annonce plus étroit, on vérifie à l'exécution. */
export function estPaireDeCles(valeur: unknown): valeur is CryptoKeyPair {
  return estObjet(valeur) && valeur.publicKey instanceof CryptoKey && valeur.privateKey instanceof CryptoKey;
}
