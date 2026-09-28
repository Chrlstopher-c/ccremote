// Responsabilité : les boutons d'outil — icône seule avec bulle d'aide, ou compact avec libellé. Aucun relief de site.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Ton = 'normal' | 'accent' | 'danger';

const TONS: Record<Ton, string> = {
  normal: 'text-encre-2 hover:bg-survol hover:text-encre',
  accent: 'bg-accent text-white hover:brightness-110',
  danger: 'text-danger hover:bg-survol',
};

interface PropsIcone extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly aide: string;
  readonly raccourci?: string;
  readonly ton?: Ton;
  readonly actif?: boolean;
}

export function IconeBouton(p: PropsIcone): ReactNode {
  const { aide, raccourci, ton = 'normal', actif, className = '', children, ...reste } = p;
  return (
    <button
      type="button"
      title={raccourci ? `${aide} (${raccourci})` : aide}
      aria-label={aide}
      className={`grid size-7 shrink-0 cursor-default place-items-center rounded-[6px] transition-colors
        disabled:opacity-35 disabled:hover:bg-transparent ${actif ? 'bg-survol text-encre' : TONS[ton]} ${className}`}
      {...reste}
    >
      {children}
    </button>
  );
}

interface PropsBouton extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly ton?: Ton;
  readonly icone?: ReactNode;
}

export function Bouton({ ton = 'normal', icone, className = '', children, ...reste }: PropsBouton): ReactNode {
  const cadre = ton === 'accent' ? '' : 'ring-1 ring-filet';
  return (
    <button
      type="button"
      className={`inline-flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px]
        font-semibold transition-colors disabled:opacity-40 ${cadre} ${TONS[ton]} ${className}`}
      {...reste}
    >
      {icone}
      {children}
    </button>
  );
}
