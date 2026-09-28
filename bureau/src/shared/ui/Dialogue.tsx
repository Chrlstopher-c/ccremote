// Responsabilité : le panneau modal de l'app (ouverture de session, confirmations) — sobre, au clavier (Échap).
import { type ReactNode, useEffect } from 'react';

interface Props {
  readonly ouvert: boolean;
  readonly surFermer: () => void;
  readonly titre: string;
  readonly largeur?: number;
  readonly children: ReactNode;
}

function useEchap(actif: boolean, surFermer: () => void): void {
  useEffect(() => {
    if (!actif) return;
    const echap = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') surFermer();
    };
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [actif, surFermer]);
}

export function Dialogue({ ouvert, surFermer, titre, largeur = 520, children }: Props): ReactNode {
  useEchap(ouvert, surFermer);
  if (!ouvert) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && surFermer()}>
      <div role="dialog" aria-modal="true" aria-label={titre} style={{ maxWidth: largeur }}
        className={`w-full overflow-hidden rounded-[10px]
          bg-fond shadow-[0_20px_60px_-10px_rgba(0,0,0,0.45)] ring-1 ring-filet`}>
        <div className="border-b border-filet px-4 py-2.5 text-[13px] font-bold">{titre}</div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
