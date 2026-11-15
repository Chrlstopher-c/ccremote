// Responsabilité : la colonne « éditeur » de la bibliothèque — nom du fichier, état (modifié, enregistré), bouton
// Enregistrer, erreurs, et la feuille CodeMirror ; ou un message quand l'aperçu est impossible.
import { useEffect, useRef } from 'react';

import type { ServiceFichiers } from '../../donnees';
import { nomDe } from './chemins';
import { useEditeur, type EtatEditeur } from './use-editeur';

interface Props {
  readonly service: ServiceFichiers;
  readonly machine: string;
  readonly chemin: string;
  readonly taille: number | null;
  readonly surModifie: (modifie: boolean) => void;
}

function Entete(p: { readonly chemin: string; readonly e: EtatEditeur }) {
  const { e } = p;
  let etat = '';
  if (e.modifie) etat = '● modifié';
  else if (e.enregistreA) etat = `enregistré à ${e.enregistreA}`;
  return (
    <div className="biblio-entete">
      <div className="biblio-fichier" title={p.chemin}>
        <span className="titre-pixel">{nomDe(p.chemin)}</span>
        <span className={`biblio-etat ${e.modifie ? 'modifie' : ''}`}>{etat}</span>
      </div>
      <button className="bouton-pixel primaire" title="Enregistrer (Ctrl+S)"
        disabled={e.phase !== 'pret' || e.enregistrement || !e.modifie} onClick={e.enregistrer}>
        {e.enregistrement ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </div>
  );
}

function Message(p: { readonly phase: EtatEditeur['phase'] }) {
  if (p.phase === 'chargement') return <div className="biblio-message">Lecture du fichier…</div>;
  if (p.phase === 'impossible') {
    return (
      <div className="biblio-message">
        <span className="titre-pixel">Aperçu impossible</span>
        <span>Fichier binaire ou trop volumineux pour l’éditeur.</span>
      </div>
    );
  }
  return null;
}

export function Editeur(p: Props) {
  const conteneur = useRef<HTMLDivElement>(null);
  const e = useEditeur(conteneur, { service: p.service, machine: p.machine, chemin: p.chemin, taille: p.taille });
  const { surModifie } = p;
  useEffect(() => surModifie(e.modifie), [e.modifie, surModifie]);
  return (
    <div className="biblio-editeur">
      <Entete chemin={p.chemin} e={e} />
      {e.erreur ? <div className="biblio-erreur" role="alert">{e.erreur}</div> : null}
      <Message phase={e.phase} />
      <div className="biblio-feuille" ref={conteneur} hidden={e.phase !== 'pret'} />
    </div>
  );
}

export function EditeurVide() {
  return (
    <div className="biblio-editeur">
      <div className="biblio-message">
        <span className="titre-pixel">Aucun fichier ouvert</span>
        <span>Choisis un fichier dans l’arborescence.</span>
      </div>
    </div>
  );
}
