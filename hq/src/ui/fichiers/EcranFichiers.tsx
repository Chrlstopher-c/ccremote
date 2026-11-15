// Responsabilité : le panneau « bibliothèque » (fichiers d'un poste), sur papier — arborescence à gauche, éditeur du
// fichier choisi à droite ; onglets sur téléphone. Un chemin de fichier ouvre son dossier et le sélectionne.
import { useEffect, useState, type KeyboardEvent } from 'react';

import type { ServiceFichiers } from '../../donnees';
import { useMondeBrut } from '../contexte';
import { Panneau } from '../Panneau';
import { Arborescence } from './Arborescence';
import { Editeur, EditeurVide } from './Editeur';
import { journaliserFichiers, messageErreur } from './journal';
import { nomDe } from './chemins';
import { resoudreDepart, useDossier, type Depart } from './use-dossier';
import { useSelection } from './use-selection';
import './fichiers.css';

interface Props {
  readonly machine: string;
  readonly chemin: string;
  readonly sessionId?: string;
}

function useDepart(service: ServiceFichiers, machine: string, chemin: string) {
  const [depart, setDepart] = useState<Depart | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    resoudreDepart(service, machine, chemin)
      .then((d) => actif && setDepart(d))
      .catch((e: unknown) => {
        if (!actif) return;
        journaliserFichiers('chemin de départ introuvable', { machine, chemin, erreur: messageErreur(e) });
        setErreur(`Impossible d’ouvrir « ${chemin} » : ${messageErreur(e)}`);
      });
    return () => {
      actif = false;
    };
  }, [service, machine, chemin]);
  return { depart, erreur };
}

function Attente(p: { readonly nom: string; readonly abandonner: () => void; readonly rester: () => void }) {
  return (
    <div className="biblio-confirme" role="alertdialog">
      <span>Modifications non enregistrées. Ouvrir « {p.nom} » quand même ?</span>
      <button className="bouton-pixel danger" onClick={p.abandonner}>Abandonner</button>
      <button className="bouton-pixel" onClick={p.rester}>Rester</button>
    </div>
  );
}

function Onglets(p: { readonly s: ReturnType<typeof useSelection> }) {
  const { s } = p;
  const nom = s.selection ? nomDe(s.selection.chemin) : 'Éditeur';
  return (
    <div className="biblio-onglets" role="tablist">
      <button role="tab" aria-selected={s.onglet === 'arbre'} className={s.onglet === 'arbre' ? 'actif' : ''}
        onClick={() => s.setOnglet('arbre')}>Dossier</button>
      <button role="tab" aria-selected={s.onglet === 'editeur'} className={s.onglet === 'editeur' ? 'actif' : ''}
        onClick={() => s.setOnglet('editeur')}>{nom}</button>
    </div>
  );
}

/** Le monde (Phaser) écoute le clavier sur window : la frappe dans le panneau ne doit pas lui parvenir (Échap si). */
function garderClavier(e: KeyboardEvent): void {
  if (e.key !== 'Escape') e.stopPropagation();
}

function Contenu(p: Props & { readonly service: ServiceFichiers; readonly depart: Depart }) {
  const etat = useDossier(p.service, p.machine, p.depart.dossier);
  const s = useSelection(p.depart.fichier ? { chemin: p.depart.fichier, taille: null } : null);
  return (
    <div className={`biblio onglet-${s.onglet}`} onKeyDown={garderClavier}>
      <Onglets s={s} />
      <Arborescence etat={etat} service={p.service} machine={p.machine} selection={s.selection?.chemin ?? null}
        choisirFichier={s.choisir} deplace={s.deplace} />
      <div className="biblio-droite">
        {s.attente ? <Attente nom={nomDe(s.attente.chemin)} abandonner={s.abandonner} rester={s.rester} /> : null}
        {s.selection ? (
          <Editeur key={s.selection.chemin} service={p.service} machine={p.machine} chemin={s.selection.chemin}
            taille={s.selection.taille} surModifie={s.setModifie} />
        ) : <EditeurVide />}
      </div>
    </div>
  );
}

export default function EcranFichiers(p: Props) {
  const { source } = useMondeBrut();
  const { depart, erreur } = useDepart(source.fichiers, p.machine, p.chemin);
  let corps = <div className="biblio-message">Ouverture de la bibliothèque…</div>;
  if (erreur) corps = <div className="biblio-message erreur" role="alert">{erreur}</div>;
  else if (depart) corps = <Contenu {...p} service={source.fichiers} depart={depart} />;
  return (
    <Panneau variante="bois" large titre="Bibliothèque" sousTitre={`${p.machine} · fichiers du poste`}>
      {corps}
    </Panneau>
  );
}
