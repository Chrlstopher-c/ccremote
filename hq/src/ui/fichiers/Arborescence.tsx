// Responsabilité : la colonne « arborescence » de la bibliothèque — chemin courant, remonter, créer un dossier, liste
// des entrées (ouvrir un dossier, sélectionner un fichier, renommer, supprimer avec confirmation).
import { useEffect, useState } from 'react';

import type { EntreeFichier, ServiceFichiers } from '../../donnees';
import { joindre } from './chemins';
import { LigneEntree, type ModeLigne } from './LigneEntree';
import { SaisieNom } from './SaisieNom';
import type { EtatDossier } from './use-dossier';

interface Props {
  readonly etat: EtatDossier;
  readonly service: ServiceFichiers;
  readonly machine: string;
  readonly selection: string | null;
  readonly choisirFichier: (chemin: string, entree: EntreeFichier) => void;
  /** Un élément a changé de chemin (renommé : `vers`, supprimé : null). */
  readonly deplace: (de: string, vers: string | null) => void;
}

type Edition = { readonly nom: string; readonly mode: ModeLigne } | { readonly mode: 'creer' } | null;

function Barre(p: { readonly etat: EtatDossier; readonly creer: () => void }) {
  const liste = p.etat.liste;
  return (
    <div className="biblio-barre">
      <button className="bouton-pixel" disabled={!liste?.parent} title="Dossier parent"
        onClick={() => liste?.parent && p.etat.aller(liste.parent)}>↑ Remonter</button>
      <button className="bouton-pixel" disabled={!liste} onClick={p.creer}>+ Dossier</button>
      <div className="biblio-chemin" title={liste?.chemin}>{liste ? `\u200e${liste.chemin}\u200e` : '…'}</div>
    </div>
  );
}

function useOperations(p: Props, fin: () => void) {
  const dossier = p.etat.liste?.chemin ?? '/';
  const { service, machine } = p;
  return {
    creer: (nom: string) => {
      fin();
      void p.etat.operer('Création du dossier', () => service.creerDossier(machine, joindre(dossier, nom)));
    },
    renommer: (entree: EntreeFichier, nom: string) => {
      fin();
      const de = joindre(dossier, entree.nom);
      const vers = joindre(dossier, nom);
      void p.etat
        .operer('Renommage', () => service.renommer(machine, de, vers))
        .then((ok) => ok && p.deplace(de, vers));
    },
    supprimer: (entree: EntreeFichier) => {
      fin();
      const chemin = joindre(dossier, entree.nom);
      void p.etat
        .operer('Suppression', () => service.supprimer(machine, chemin))
        .then((ok) => ok && p.deplace(chemin, null));
    },
  };
}

function Liste(p: Props & { readonly edition: Edition; readonly setEdition: (e: Edition) => void }) {
  const liste = p.etat.liste;
  const op = useOperations(p, () => p.setEdition(null));
  if (!liste) return <div className="biblio-vide">{p.etat.chargement ? 'Ouverture…' : 'Aucun dossier ouvert.'}</div>;
  const ed = p.edition;
  if (liste.entrees.length === 0 && ed?.mode !== 'creer') return <div className="biblio-vide">Dossier vide.</div>;
  const modeDe = (nom: string): ModeLigne => (ed && 'nom' in ed && ed.nom === nom ? ed.mode : 'normal');
  return (
    <ul className="biblio-liste">
      {p.edition?.mode === 'creer' ? (
        <li className="biblio-ligne edition">
          <SaisieNom initial="" libelle="Nom du dossier" valider={op.creer} annuler={() => p.setEdition(null)} />
        </li>
      ) : null}
      {liste.entrees.map((e) => {
        const chemin = joindre(liste.chemin, e.nom);
        return (
          <LigneEntree key={e.nom} entree={e} choisie={chemin === p.selection} mode={modeDe(e.nom)}
            ouvrir={() => (e.type === 'dossier' ? p.etat.aller(chemin) : p.choisirFichier(chemin, e))}
            changerMode={(mode) => p.setEdition(mode === 'normal' ? null : { nom: e.nom, mode })}
            renommer={(nom) => op.renommer(e, nom)} supprimer={() => op.supprimer(e)} />
        );
      })}
    </ul>
  );
}

export function Arborescence(p: Props) {
  const [edition, setEdition] = useState<Edition>(null);
  const dossier = p.etat.liste?.chemin;
  useEffect(() => setEdition(null), [dossier]);
  return (
    <div className="biblio-arbre">
      <Barre etat={p.etat} creer={() => setEdition({ mode: 'creer' })} />
      {p.etat.erreur ? (
        <div className="biblio-erreur" role="alert">
          <span>{p.etat.erreur}</span>
          <button className="biblio-outil" aria-label="Masquer l’erreur" onClick={p.etat.effacerErreur}>✕</button>
        </div>
      ) : null}
      <div className="biblio-defile">
        <Liste {...p} edition={edition} setEdition={setEdition} />
      </div>
    </div>
  );
}
