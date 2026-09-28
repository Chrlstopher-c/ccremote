// Responsabilité : le thème de l'app — suivre le système, ou forcer clair / sombre. Mémorisé sur ce poste, posé sur
// <html data-theme> que la feuille de style lit (index.css).
import { useSyncExternalStore } from 'react';

export type Theme = 'systeme' | 'clair' | 'sombre';

const CLE = 'quart.theme';
const ORDRE: readonly Theme[] = ['systeme', 'clair', 'sombre'];
const abonnes = new Set<() => void>();

function lire(): Theme {
  try {
    const v = localStorage.getItem(CLE);
    return v === 'clair' || v === 'sombre' ? v : 'systeme';
  } catch {
    return 'systeme'; // stockage indisponible : on suit le système
  }
}

let courant: Theme = lire();

function appliquer(t: Theme): void {
  if (t === 'systeme') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/** À appeler avant le premier rendu : pas de flash du mauvais thème au lancement. */
export function initialiserTheme(): void {
  appliquer(courant);
}

export function choisirTheme(t: Theme): void {
  courant = t;
  appliquer(t);
  try {
    localStorage.setItem(CLE, t);
  } catch {
    // stockage indisponible : le choix vaut pour cette ouverture seulement
  }
  for (const f of abonnes) f();
}

export function themeSuivant(t: Theme): Theme {
  return ORDRE[(ORDRE.indexOf(t) + 1) % ORDRE.length] ?? 'systeme';
}

export const LIBELLES_THEME: Readonly<Record<Theme, string>> = {
  systeme: 'Thème du système',
  clair: 'Thème clair',
  sombre: 'Thème sombre',
};

export function useTheme(): Theme {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
    () => courant,
  );
}
