// Responsabilité : quel fichier est ouvert dans l'éditeur — choix depuis l'arborescence, garde des modifications non
// enregistrées (choix mis en attente), suivi des renommages et suppressions, onglet affiché sur téléphone.
import { useCallback, useState } from 'react';

import type { EntreeFichier } from '../../donnees';

export interface Selection {
  readonly chemin: string;
  readonly taille: number | null;
}

export type Onglet = 'arbre' | 'editeur';

export function useSelection(initiale: Selection | null) {
  const [selection, setSelection] = useState<Selection | null>(initiale);
  const [attente, setAttente] = useState<Selection | null>(null);
  const [modifie, setModifie] = useState(false);
  const [onglet, setOnglet] = useState<Onglet>(initiale ? 'editeur' : 'arbre');
  const ouvrir = useCallback((s: Selection | null) => {
    setSelection(s);
    setAttente(null);
    setModifie(false);
    if (s) setOnglet('editeur');
  }, []);
  const choisir = (chemin: string, entree: EntreeFichier): void => {
    const s = { chemin, taille: entree.taille };
    if (chemin === selection?.chemin) setOnglet('editeur');
    else if (modifie) setAttente(s);
    else ouvrir(s);
  };
  const deplace = (de: string, vers: string | null): void => {
    if (!selection) return;
    const c = selection.chemin;
    if (c !== de && !c.startsWith(`${de}/`)) return;
    if (vers === null) setModifie(false);
    setSelection(vers === null ? null : { chemin: vers + c.slice(de.length), taille: selection.taille });
  };
  return {
    selection, attente, onglet, setOnglet, setModifie, ouvrir, choisir, deplace,
    abandonner: () => attente && ouvrir(attente),
    rester: () => setAttente(null),
  };
}
