// Responsabilité : repérer l'adresse du tunnel VPN sous macOS, où WireGuard prend un nom utun* et non wg*, par le
// sous-réseau du tunnel (configuré hors du code). Pur : les interfaces sont passées en paramètre.
export type InterfacesTunnel = Readonly<
  Record<string, readonly { readonly family: string | number; readonly address: string }[] | undefined>
>;

const PREFIXE_UTUN = 'utun';

/** Adresse IPv4 en entier non signé ; null si ce n'est pas une IPv4 valide. */
function ipVersEntier(ip: string): number | null {
  const octets = ip.split('.');
  if (octets.length !== 4) return null;
  let total = 0;
  for (const o of octets) {
    const n = Number(o);
    if (!/^\d{1,3}$/.test(o) || n > 255) return null;
    total = total * 256 + n;
  }
  return total;
}

/** Vrai si `ip` appartient au sous-réseau `cidr` (ex. `198.51.100.0/24`) ; faux si le CIDR est invalide. */
export function dansSousReseau(ip: string, cidr: string): boolean {
  const [base = '', bitsTexte = ''] = cidr.split('/');
  const bits = Number(bitsTexte);
  const adresse = ipVersEntier(ip);
  const reseau = ipVersEntier(base);
  if (adresse === null || reseau === null || !/^\d{1,2}$/.test(bitsTexte) || bits > 32) return false;
  const masque = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((adresse & masque) >>> 0) === ((reseau & masque) >>> 0);
}

/** Adresse IPv4 d'une interface utun* dans le sous-réseau du tunnel ; null si aucune, ou sans sous-réseau. */
export function ecouteTunnelMac(interfaces: InterfacesTunnel, sousReseau: string | null): string | null {
  if (sousReseau === null) return null;
  for (const [nom, adresses] of Object.entries(interfaces)) {
    if (!nom.startsWith(PREFIXE_UTUN)) continue;
    const dedans = adresses?.find(
      (a) => (a.family === 'IPv4' || a.family === 4) && dansSousReseau(a.address, sousReseau),
    );
    if (dedans) return dedans.address;
  }
  return null;
}
