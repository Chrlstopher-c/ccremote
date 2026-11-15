// Responsabilité : l'éditeur CodeMirror d'un fichier — lecture, détection des fichiers impossibles à afficher
// (binaires, trop gros), suivi de l'état « modifié », enregistrement (bouton ou Ctrl+S) et erreurs visibles.
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { ErreurRelais, TAILLE_MAX_EDITION, type ServiceFichiers } from '../../donnees';
import { nomDe } from './chemins';
import { journaliserFichiers, messageErreur } from './journal';
import { langageDe } from './langages';
import { THEME_PAPIER } from './theme-papier';

export type Phase = 'chargement' | 'pret' | 'impossible' | 'erreur';

export interface EtatEditeur {
  readonly phase: Phase;
  readonly modifie: boolean;
  readonly enregistrement: boolean;
  readonly erreur: string | null;
  readonly enregistreA: string | null;
  enregistrer(): void;
}

export interface OptionsEditeur {
  readonly service: ServiceFichiers;
  readonly machine: string;
  readonly chemin: string;
  readonly taille: number | null;
}

/** Binaire si un octet nul apparaît ou si plus de 1 % des caractères sont illisibles. */
function estBinaire(texte: string): boolean {
  if (texte.includes('\u0000')) return true;
  const illisibles = texte.match(/�/g)?.length ?? 0;
  return illisibles > Math.max(2, texte.length / 100);
}

function creerVue(parent: HTMLElement, texte: string, nom: string, changement: () => void): EditorView {
  const ecoute = EditorView.updateListener.of((u) => {
    if (u.docChanged) changement();
  });
  const extensions = [basicSetup, langageDe(nom), THEME_PAPIER, ecoute, EditorView.lineWrapping];
  const etat = EditorState.create({ doc: texte, extensions });
  return new EditorView({ state: etat, parent });
}

async function lireTexte(o: OptionsEditeur): Promise<string | null> {
  if (o.taille !== null && o.taille > TAILLE_MAX_EDITION) return null;
  try {
    const texte = await o.service.lire(o.machine, o.chemin);
    return estBinaire(texte) ? null : texte;
  } catch (e) {
    if (e instanceof ErreurRelais && e.statut === 413) return null;
    throw e;
  }
}

type Vue = { current: EditorView | null };

function useChargement(
  conteneur: RefObject<HTMLDivElement | null>,
  o: OptionsEditeur,
  vue: Vue,
  modifie: (m: boolean) => void,
) {
  const [phase, setPhase] = useState<Phase>('chargement');
  const [erreur, setErreur] = useState<string | null>(null);
  const options = useRef(o);
  options.current = o;
  useEffect(() => {
    let actif = true;
    setPhase('chargement');
    setErreur(null);
    modifie(false);
    lireTexte(options.current)
      .then((texte) => {
        if (!actif || !conteneur.current) return;
        if (texte === null) return setPhase('impossible');
        vue.current = creerVue(conteneur.current, texte, nomDe(options.current.chemin), () => modifie(true));
        setPhase('pret');
      })
      .catch((e: unknown) => {
        if (!actif) return;
        journaliserFichiers('lecture impossible', { chemin: options.current.chemin, erreur: messageErreur(e) });
        setErreur(`Lecture impossible : ${messageErreur(e)}`);
        setPhase('erreur');
      });
    return () => {
      actif = false;
      vue.current?.destroy();
      vue.current = null;
    };
  }, [conteneur, vue, modifie, o.service, o.machine, o.chemin]);
  return { phase, erreur, setErreur };
}

function useCtrlS(action: () => void): void {
  const ref = useRef(action);
  ref.current = action;
  useEffect(() => {
    const touche = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', touche, true);
    return () => window.removeEventListener('keydown', touche, true);
  }, []);
}

export function useEditeur(conteneur: RefObject<HTMLDivElement | null>, o: OptionsEditeur): EtatEditeur {
  const vue = useRef<EditorView | null>(null);
  const [modifie, setModifie] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistreA, setEnregistreA] = useState<string | null>(null);
  const { phase, erreur, setErreur } = useChargement(conteneur, o, vue, setModifie);
  const { service, machine, chemin } = o;
  useEffect(() => setEnregistreA(null), [chemin]);
  const enregistrer = useCallback(async (): Promise<void> => {
    const v = vue.current;
    if (!v) return;
    const contenu = v.state.doc.toString();
    setEnregistrement(true);
    try {
      await service.ecrire(machine, chemin, contenu);
      setErreur(null);
      setEnregistreA(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      setModifie(v.state.doc.toString() !== contenu);
    } catch (e) {
      journaliserFichiers('enregistrement impossible', { machine, chemin, erreur: messageErreur(e) });
      setErreur(`Enregistrement impossible : ${messageErreur(e)}`);
    } finally {
      setEnregistrement(false);
    }
  }, [service, machine, chemin, setErreur]);
  useCtrlS(() => void enregistrer());
  return { phase, modifie, enregistrement, erreur, enregistreA, enregistrer: () => void enregistrer() };
}
