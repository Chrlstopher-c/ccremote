// Responsabilité : les choix du formulaire d'embauche — machine (en ligne seulement), projet (liste filtrable des
// projets de la machine) et modèle (Opus, Sonnet, Haiku).
import { useMemo, useState } from 'react';

import type { Projet, VueMachine } from '../../donnees';
import { MODELES } from '../../donnees/ouverture';

export function ChoixMachine(p: { machines: readonly VueMachine[]; choisie: string; choisir: (id: string) => void }) {
  if (p.machines.length === 0) return <div className="embauche-vide">Aucune machine connue du relais.</div>;
  return (
    <div className="embauche-machines" role="radiogroup" aria-label="Machine">
      {p.machines.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={p.choisie === m.id}
          disabled={!m.enLigne}
          className={`embauche-machine ${p.choisie === m.id ? 'choisie' : ''}`}
          onClick={() => p.choisir(m.id)}
        >
          <span className={`embauche-led ${m.enLigne ? 'en-ligne' : ''}`} />
          <span className="embauche-machine-nom">{m.id}</span>
          <span className="embauche-machine-desc">{m.enLigne ? m.description || 'en ligne' : 'hors ligne'}</span>
        </button>
      ))}
    </div>
  );
}

function filtrer(projets: readonly Projet[], filtre: string): readonly Projet[] {
  const q = filtre.trim().toLowerCase();
  const tries = [...projets].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return q ? tries.filter((x) => x.nom.toLowerCase().includes(q) || x.chemin.toLowerCase().includes(q)) : tries;
}

export function ChoixProjet(p: { projets: readonly Projet[]; choisi: Projet | null; choisir: (x: Projet) => void }) {
  const [filtre, setFiltre] = useState('');
  const visibles = useMemo(() => filtrer(p.projets, filtre), [p.projets, filtre]);
  return (
    <div className="embauche-projets">
      <input
        className="embauche-champ"
        placeholder={`Filtrer ${p.projets.length} projet${p.projets.length > 1 ? 's' : ''}…`}
        value={filtre}
        onChange={(e) => setFiltre(e.target.value)}
        aria-label="Filtrer les projets"
      />
      <ul className="embauche-liste" role="listbox" aria-label="Projet">
        {visibles.map((x) => (
          <li key={x.chemin}>
            <button
              type="button"
              role="option"
              aria-selected={p.choisi?.chemin === x.chemin}
              className={p.choisi?.chemin === x.chemin ? 'choisi' : ''}
              onClick={() => p.choisir(x)}
            >
              <span className="embauche-projet-nom">{x.nom}</span>
              <span className="embauche-projet-chemin">{x.chemin}</span>
            </button>
          </li>
        ))}
        {visibles.length === 0 ? <li className="embauche-vide">Aucun projet ne correspond.</li> : null}
      </ul>
    </div>
  );
}

export function ChoixModele(p: { choisi: string; choisir: (id: string) => void }) {
  return (
    <div className="embauche-modeles" role="radiogroup" aria-label="Modèle">
      {MODELES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={p.choisi === m.id}
          className={`bouton-pixel ${p.choisi === m.id ? 'primaire' : ''}`}
          onClick={() => p.choisir(m.id)}
        >
          {m.libelle}
        </button>
      ))}
    </div>
  );
}
