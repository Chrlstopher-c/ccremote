// Responsabilité : l'état d'un dossier affiché dans la bibliothèque — résolution du chemin de départ (dossier ou
// fichier), liste des entrées, navigation, et opérations (créer un dossier, renommer, supprimer) avec erreurs visibles.
import { useCallback, useEffect, useState } from 'react';

import type { ListeDossier, ServiceFichiers } from '../../donnees';
import { joindre, nomDe, parentDe } from './chemins';
import { journaliserFichiers, messageErreur } from './journal';

export interface Depart {
  readonly dossier: string;
  readonly fichier: string | null;
}

/** Un chemin listable est un dossier ; sinon on ouvre son parent et on y sélectionne le fichier. */
export async function resoudreDepart(service: ServiceFichiers, machine: string, chemin: string): Promise<Depart> {
  try {
    const liste = await service.lister(machine, chemin);
    return { dossier: liste.chemin, fichier: null };
  } catch (erreur) {
    const parent = parentDe(chemin);
    if (parent === null) throw erreur;
    const liste = await service.lister(machine, parent);
    const entree = liste.entrees.find((e) => e.nom === nomDe(chemin));
    if (!entree) throw erreur;
    return { dossier: liste.chemin, fichier: joindre(liste.chemin, entree.nom) };
  }
}

export interface EtatDossier {
  readonly liste: ListeDossier | null;
  readonly chargement: boolean;
  readonly erreur: string | null;
  aller(chemin: string): void;
  effacerErreur(): void;
  /** Exécute une opération puis recharge ; renvoie faux (et affiche l'erreur) si elle échoue. */
  operer(libelle: string, f: () => Promise<void>): Promise<boolean>;
}

function useListe(service: ServiceFichiers, machine: string, dossier: string | null) {
  const [liste, setListe] = useState<ListeDossier | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = useCallback(async (chemin: string): Promise<void> => {
    setChargement(true);
    try {
      setListe(await service.lister(machine, chemin));
    } catch (e) {
      journaliserFichiers('dossier illisible', { machine, chemin, erreur: messageErreur(e) });
      setErreur(`Dossier illisible : ${messageErreur(e)}`);
    } finally {
      setChargement(false);
    }
  }, [service, machine]);
  useEffect(() => {
    if (dossier !== null) void charger(dossier);
  }, [dossier, charger]);
  return { liste, chargement, erreur, setErreur, charger };
}

export function useDossier(service: ServiceFichiers, machine: string, depart: string | null): EtatDossier {
  const [dossier, setDossier] = useState<string | null>(depart);
  useEffect(() => setDossier(depart), [depart]);
  const l = useListe(service, machine, dossier);
  const { setErreur, charger } = l;
  const operer = useCallback(async (libelle: string, f: () => Promise<void>): Promise<boolean> => {
    try {
      await f();
      return true;
    } catch (e) {
      journaliserFichiers(`${libelle} impossible`, { machine, erreur: messageErreur(e) });
      setErreur(`${libelle} impossible : ${messageErreur(e)}`);
      return false;
    } finally {
      if (dossier !== null) await charger(dossier);
    }
  }, [machine, dossier, charger, setErreur]);
  return {
    liste: l.liste,
    chargement: l.chargement,
    erreur: l.erreur,
    aller: (chemin) => {
      setErreur(null);
      setDossier(chemin);
    },
    effacerErreur: () => setErreur(null),
    operer,
  };
}
