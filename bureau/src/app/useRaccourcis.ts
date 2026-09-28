// Responsabilité : les raccourcis clavier de l'app — palette, nouvelle session, parcours de la liste, terminal, écrire.
import { useEffect } from 'react';

export interface Raccourcis {
  readonly palette: () => void;
  readonly nouvelle: () => void;
  readonly suivante: () => void;
  readonly precedente: () => void;
  readonly terminal: () => void;
  readonly ecrire: () => void;
}

function dansUnChamp(e: KeyboardEvent): boolean {
  const cible = e.target as HTMLElement | null; // un évènement clavier vient toujours d'un élément du document
  return !!cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.tagName === 'SELECT');
}

export function useRaccourcis(r: Raccourcis): void {
  useEffect(() => {
    const surTouche = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') r.palette();
      else if (mod && e.key.toLowerCase() === 'n') r.nouvelle();
      else if (mod && e.key.toLowerCase() === 't') r.terminal();
      else if (dansUnChamp(e) || mod) return;
      else if (e.key === 'j' || e.key === 'ArrowDown') r.suivante();
      else if (e.key === 'k' || e.key === 'ArrowUp') r.precedente();
      else if (e.key === '/') r.ecrire();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [r]);
}
