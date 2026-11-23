// Responsabilité : la paire WireGuard d'un invité (X25519, clés brutes en base64) et le texte wg-quick qui la relie au
// serveur. La clé privée vit le temps d'une requête : elle n'est ni écrite sur disque, ni journalisée.
import { generateKeyPairSync } from 'node:crypto';

/** Clés en base64 standard de 32 octets (44 caractères), au format attendu par WireGuard. */
export interface PaireVpn {
  readonly publique: string;
  readonly privee: string;
}

export interface ParamsConfigVpn {
  readonly adresse: string;
  readonly privee: string;
  readonly cleServeur: string;
  readonly endpoint: string;
  readonly adresseAiguilleur: string;
}

function octetsDe(valeur: string | undefined): string {
  if (!valeur) throw new Error('clé X25519 inattendue : composante absente');
  return Buffer.from(valeur, 'base64url').toString('base64');
}

export function paireVpnNeuve(): PaireVpn {
  const paire = generateKeyPairSync('x25519');
  const publique = paire.publicKey.export({ format: 'jwk' });
  const privee = paire.privateKey.export({ format: 'jwk' });
  return { publique: octetsDe(publique.x), privee: octetsDe(privee.d) };
}

/** Texte wg-quick complet, tel qu'il est remis à l'invité (un seul pair : l'aiguilleur, sur sa seule adresse VPN). */
export function configWireguard(p: ParamsConfigVpn): string {
  return [
    '[Interface]',
    `PrivateKey = ${p.privee}`,
    `Address = ${p.adresse}/32`,
    '',
    '[Peer]',
    `PublicKey = ${p.cleServeur}`,
    `Endpoint = ${p.endpoint}`,
    `AllowedIPs = ${p.adresseAiguilleur}/32`,
    'PersistentKeepalive = 25',
    '',
  ].join('\n');
}
