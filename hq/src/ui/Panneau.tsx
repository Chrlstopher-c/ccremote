// Responsabilité : le cadre commun des panneaux (écran d'ordinateur, papier, écran cathodique) — titre pixel, bouton
// fermer, Échap pour fermer, plein écran sur téléphone. Le contenu est libre.
import { useEffect, type ReactNode } from 'react';

import { fermer } from './bus';
import './panneau.css';

export type Variante = 'ecran' | 'bois' | 'crt';

interface Props {
  titre: ReactNode;
  sousTitre?: ReactNode;
  variante: Variante;
  actions?: ReactNode;
  large?: boolean;
  children: ReactNode;
}

export function Panneau(p: Props) {
  useEffect(() => {
    const echap = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') fermer();
    };
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, []);
  return (
    <div className="panneau-voile interactif" onPointerDown={(e) => e.target === e.currentTarget && fermer()}>
      <section className={`panneau cadre-${p.variante} ${p.large ? 'large' : ''}`} role="dialog">
        <header className="panneau-tete">
          <div className="panneau-titres">
            <h2 className="titre-pixel">{p.titre}</h2>
            {p.sousTitre ? <div className="panneau-sous">{p.sousTitre}</div> : null}
          </div>
          <div className="panneau-actions">{p.actions}</div>
          <button className="bouton-pixel discret panneau-fermer" onClick={fermer} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="panneau-corps">{p.children}</div>
      </section>
    </div>
  );
}
