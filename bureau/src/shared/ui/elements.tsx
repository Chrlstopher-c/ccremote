// Responsabilité : petites primitives d'outil — point d'état, jauge fine, bascule, champs, raccourci clavier.
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export type TonPoint = 'actif' | 'calme' | 'eteint' | 'alerte';

export function Point({ ton }: { readonly ton: TonPoint }): ReactNode {
  const c = { actif: 'bg-accent', calme: 'bg-succes', eteint: 'bg-discret/40', alerte: 'bg-danger' }[ton];
  const pulse = ton === 'actif' ? 'animate-pulse motion-reduce:animate-none' : '';
  return <span className={`inline-block size-[7px] shrink-0 rounded-full ${c} ${pulse}`} />;
}

export function Jauge({ valeur, alerte = 0.8, largeur = 'w-full' }: {
  readonly valeur: number;
  readonly alerte?: number;
  readonly largeur?: string;
}): ReactNode {
  const v = Math.max(0, Math.min(1, valeur));
  return (
    <span className={`inline-block h-[3px] overflow-hidden rounded-full bg-filet align-middle ${largeur}`}>
      <span className={`block h-full rounded-full ${v >= alerte ? 'bg-danger' : 'bg-accent'}`}
        style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export function Bascule({ active, onChange, libelle }: {
  readonly active: boolean;
  readonly onChange: (v: boolean) => void;
  readonly libelle: string;
}): ReactNode {
  return (
    <button type="button" role="switch" aria-checked={active} aria-label={libelle} title={libelle}
      onClick={() => onChange(!active)}
      className={`relative h-[18px] w-[30px] shrink-0 cursor-default rounded-full transition-colors
        ${active ? 'bg-accent' : 'bg-filet'}`}>
      <span className={`absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-sm transition-transform
        ${active ? 'translate-x-[12px]' : ''}`} />
    </button>
  );
}

export function Touche({ children }: { readonly children: ReactNode }): ReactNode {
  return <kbd className="rounded-[4px] border border-filet px-1 font-mono text-[10.5px] text-discret">{children}</kbd>;
}

const CHAMP = 'w-full rounded-[6px] bg-champ px-2.5 text-[13px] text-encre outline-none ring-1 ring-transparent '
  + 'placeholder:text-discret focus:ring-accent select-text';

export function Champ(p: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input {...p} className={`h-8 ${CHAMP} ${p.className ?? ''}`} />;
}

export function Zone(p: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea {...p} className={`resize-none py-2 leading-relaxed ${CHAMP} ${p.className ?? ''}`} />;
}

export function Choix(p: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return <select {...p} className={`h-8 cursor-default ${CHAMP} ${p.className ?? ''}`} />;
}

export function Libelle({ children, detail }: { readonly children: ReactNode; readonly detail?: string }): ReactNode {
  return (
    <span className="mb-1 flex items-baseline justify-between text-[12px] font-semibold text-encre-2">
      {children}
      {detail && <span className="font-mono text-[10.5px] font-normal text-discret">{detail}</span>}
    </span>
  );
}
