// Responsabilité : les petites saisies en ligne de la bibliothèque — un nom (création, renommage) ou une confirmation
// de suppression. Entrée valide, Échap annule sans fermer le panneau.
import { useState, type KeyboardEvent } from 'react';

import { nomValide } from './chemins';

function clavier(e: KeyboardEvent, valider: () => void, annuler: () => void): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    valider();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    annuler();
  }
}

export function SaisieNom(p: {
  readonly initial: string;
  readonly libelle: string;
  readonly valider: (nom: string) => void;
  readonly annuler: () => void;
}) {
  const [nom, setNom] = useState(p.initial);
  const ok = nomValide(nom) && nom.trim() !== p.initial;
  const valider = (): void => {
    if (ok) p.valider(nom.trim());
  };
  return (
    <div className="biblio-saisie" onKeyDown={(e) => clavier(e, valider, p.annuler)}>
      <input
        autoFocus
        value={nom}
        aria-label={p.libelle}
        placeholder={p.libelle}
        onChange={(e) => setNom(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
      <button className="bouton-pixel primaire" disabled={!ok} onClick={valider}>OK</button>
      <button className="bouton-pixel" onClick={p.annuler}>Annuler</button>
    </div>
  );
}

export function Confirmation(p: { readonly nom: string; readonly valider: () => void; readonly annuler: () => void }) {
  return (
    <div className="biblio-confirme" role="alertdialog" onKeyDown={(e) => clavier(e, p.valider, p.annuler)}>
      <span>Supprimer « {p.nom} » ? C’est définitif.</span>
      <button className="bouton-pixel danger" autoFocus onClick={p.valider}>Supprimer</button>
      <button className="bouton-pixel" onClick={p.annuler}>Annuler</button>
    </div>
  );
}
