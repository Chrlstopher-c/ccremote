// Responsabilité : les boutons de l'app — plein à relief (action principale), fantôme, discret (icône).
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variante = 'plein' | 'fantome' | 'discret' | 'danger';

const STYLES: Record<Variante, string> = {
  plein:
    'bg-accent text-white shadow-[0_3px_0_var(--accent-relief)] hover:brightness-105 ' +
    'active:translate-y-[3px] active:shadow-none',
  fantome: 'bg-surface text-encre ring-1 ring-filet-fort hover:bg-surface-2',
  discret: 'text-encre-douce hover:bg-surface-2 hover:text-encre',
  danger: 'text-danger ring-1 ring-filet-fort hover:bg-danger-fond',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variante?: Variante;
  readonly icone?: ReactNode;
  readonly compact?: boolean;
}

export function Bouton({ variante = 'fantome', icone, compact, className = '', children, ...reste }: Props): ReactNode {
  const taille = compact ? 'h-8 px-3 text-[13px] rounded-[9px]' : 'h-10 px-4 text-[14px] rounded-[10px]';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 font-bold whitespace-nowrap transition-all duration-150
        ease-[var(--ease-doux)] disabled:opacity-45 disabled:pointer-events-none cursor-pointer
        ${taille} ${STYLES[variante]} ${className}`}
      {...reste}
    >
      {icone}
      {children}
    </button>
  );
}
