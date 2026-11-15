// Responsabilité : donner à toute l'interface l'accès au modèle de données (magasin, source, actions) et un hook
// d'abonnement par sélecteur qui ne redessine que ce qui change.
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { creerActions, type ActionsMonde, type EtatMonde, type MagasinMonde, type SourceMonde } from '../donnees';

interface Monde {
  magasin: MagasinMonde;
  source: SourceMonde;
  actions: ActionsMonde;
}

const Contexte = createContext<Monde | null>(null);

export function FournisseurMonde(props: { magasin: MagasinMonde; source: SourceMonde; children?: ReactNode }) {
  const valeur = useMemo(
    () => ({ magasin: props.magasin, source: props.source, actions: creerActions(props.source.api) }),
    [props.magasin, props.source],
  );
  return <Contexte.Provider value={valeur}>{props.children}</Contexte.Provider>;
}

export function useMondeBrut(): Monde {
  const m = useContext(Contexte);
  if (!m) throw new Error('FournisseurMonde manquant');
  return m;
}

/** Valeur dérivée de l'état du monde ; le composant se redessine quand elle change (comparaison par référence). */
export function useMonde<T>(selecteur: (e: EtatMonde) => T): T {
  const { magasin } = useMondeBrut();
  return useSyncExternalStore(
    (f) => magasin.abonner(selecteur, () => f()),
    () => selecteur(magasin.lire()),
  );
}
