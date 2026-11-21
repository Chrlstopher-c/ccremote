// Responsabilité : l'adresse d'écoute du lien duo quand LANTERNE_DUO_ECOUTE n'est pas posée — l'adresse IPv4 de la
// première interface WireGuard (nom en wg*), à défaut la boucle locale. Pur : les interfaces sont passées en paramètre.
export type InterfacesReseau = Readonly<
  Record<string, readonly { readonly family: string | number; readonly address: string }[] | undefined>
>;

export const ECOUTE_LOCALE = '127.0.0.1';

export function choisirEcoute(interfaces: InterfacesReseau): string {
  for (const [nom, adresses] of Object.entries(interfaces)) {
    if (!nom.startsWith('wg')) continue;
    const v4 = adresses?.find((a) => a.family === 'IPv4' || a.family === 4);
    if (v4) return v4.address;
  }
  return ECOUTE_LOCALE;
}
