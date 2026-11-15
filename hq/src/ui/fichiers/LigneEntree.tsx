// Responsabilité : une ligne de l'arborescence — icône (dossier ou fichier), nom, taille, et les actions renommer /
// supprimer ; remplacée par une saisie ou une confirmation quand l'action est en cours.
import type { EntreeFichier } from '../../donnees';
import { Confirmation, SaisieNom } from './SaisieNom';

export type ModeLigne = 'normal' | 'renommer' | 'supprimer';

interface Props {
  readonly entree: EntreeFichier;
  readonly choisie: boolean;
  readonly mode: ModeLigne;
  readonly ouvrir: () => void;
  readonly changerMode: (mode: ModeLigne) => void;
  readonly renommer: (nom: string) => void;
  readonly supprimer: () => void;
}

function taille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
}

export function LigneEntree(p: Props) {
  const { entree } = p;
  const annuler = (): void => p.changerMode('normal');
  if (p.mode === 'renommer') {
    return (
      <li className="biblio-ligne edition">
        <SaisieNom initial={entree.nom} libelle="Nouveau nom" valider={p.renommer} annuler={annuler} />
      </li>
    );
  }
  if (p.mode === 'supprimer') {
    return (
      <li className="biblio-ligne edition">
        <Confirmation nom={entree.nom} valider={p.supprimer} annuler={annuler} />
      </li>
    );
  }
  const dossier = entree.type === 'dossier';
  return (
    <li className={`biblio-ligne ${p.choisie ? 'choisie' : ''} ${entree.cache ? 'cachee' : ''}`}>
      <button className="biblio-nom" onClick={p.ouvrir} title={entree.nom}>
        <span className={`biblio-icone ${dossier ? 'dossier' : 'fichier'}`} aria-hidden />
        <span className="biblio-texte">{entree.nom}</span>
        {dossier ? null : <span className="biblio-taille">{taille(entree.taille)}</span>}
      </button>
      <span className="biblio-outils">
        <button className="biblio-outil" title="Renommer" aria-label={`Renommer ${entree.nom}`}
          onClick={() => p.changerMode('renommer')}>✎</button>
        <button className="biblio-outil danger" title="Supprimer" aria-label={`Supprimer ${entree.nom}`}
          onClick={() => p.changerMode('supprimer')}>✕</button>
      </span>
    </li>
  );
}
