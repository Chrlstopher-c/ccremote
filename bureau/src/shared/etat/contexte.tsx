// Responsabilité : exposer le magasin aux composants (contexte React + sélecteur abonné).
import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import type { Etat, Magasin } from './magasin.ts';

const ContexteMagasin = createContext<Magasin | null>(null);

export function FournisseurMagasin({ magasin, children }: { magasin: Magasin; children: ReactNode }): ReactNode {
  return <ContexteMagasin.Provider value={magasin}>{children}</ContexteMagasin.Provider>;
}

export function useMagasin(): Magasin {
  const m = useContext(ContexteMagasin);
  if (!m) throw new Error('useMagasin hors de FournisseurMagasin');
  return m;
}

export function useEtat<T>(selecteur: (e: Etat) => T): T {
  const m = useMagasin();
  return useSyncExternalStore(m.abonner, () => selecteur(m.lire()));
}
