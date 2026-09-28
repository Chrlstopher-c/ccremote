// Responsabilité : l'accès mémorisé de l'appareil (adresse du relais + jeton), gardé localement.
export interface Acces {
  readonly base: string;
  readonly jeton: string;
}

const CLE = 'ccremote.acces';

export function lireAcces(): Acces | null {
  try {
    const brut = localStorage.getItem(CLE);
    const a = brut ? (JSON.parse(brut) as Partial<Acces>) : null;
    return a?.base && a.jeton ? { base: a.base, jeton: a.jeton } : null;
  } catch {
    return null; // stockage indisponible ou corrompu : on redemande la connexion
  }
}

export function ecrireAcces(a: Acces | null): void {
  try {
    if (a) localStorage.setItem(CLE, JSON.stringify(a));
    else localStorage.removeItem(CLE);
  } catch {
    // stockage indisponible : l'accès ne durera que le temps de la fenêtre
  }
}

export function normaliserBase(adresse: string): string {
  const a = adresse.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(a) ? a : `https://${a}`;
}
