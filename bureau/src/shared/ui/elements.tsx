// Responsabilité : petites primitives visuelles — jauge, bascule, point d'état, tag, champ.
import { motion } from 'motion/react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Jauge({ valeur, alerte = 0.8 }: { readonly valeur: number; readonly alerte?: number }): ReactNode {
  const v = Math.max(0, Math.min(1, valeur));
  const couleur = v >= alerte ? 'bg-danger' : 'bg-accent-vif';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <motion.div
        className={`h-full rounded-full ${couleur}`}
        initial={false}
        animate={{ width: `${v * 100}%` }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
      />
    </div>
  );
}

export function Bascule({
  active,
  onChange,
  libelle,
}: {
  readonly active: boolean;
  readonly onChange: (v: boolean) => void;
  readonly libelle: string;
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={libelle}
      onClick={() => onChange(!active)}
      className={`relative h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors
        ${active ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow"
        initial={false}
        animate={{ x: active ? 16 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

export function Point({ ton }: { readonly ton: 'actif' | 'calme' | 'eteint' | 'alerte' }): ReactNode {
  const c = { actif: 'bg-accent-vif', calme: 'bg-succes', eteint: 'bg-discret/50', alerte: 'bg-danger' }[ton];
  return (
    <span className="relative inline-flex size-2">
      {ton === 'actif' && (
        <span className="absolute inset-0 animate-ping rounded-full bg-accent-vif opacity-60 motion-reduce:hidden" />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${c}`} />
    </span>
  );
}

export function Tag({
  children,
  ton = 'accent',
}: {
  readonly children: ReactNode;
  readonly ton?: 'accent' | 'neutre' | 'succes' | 'danger' | 'alerte';
}): ReactNode {
  const c = {
    accent: 'bg-accent-fond text-accent-texte',
    neutre: 'bg-surface-2 text-encre-douce',
    succes: 'bg-succes-fond text-succes',
    danger: 'bg-danger-fond text-danger',
    alerte: 'bg-alerte-fond text-alerte',
  }[ton];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${c}`}>
      {children}
    </span>
  );
}

const CHAMP =
  'w-full rounded-[10px] bg-surface px-3 text-[14px] text-encre ring-1 ring-filet-fort outline-none ' +
  'placeholder:text-discret focus:ring-2 focus:ring-accent-vif transition-shadow';

export function Champ(p: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input {...p} className={`h-10 ${CHAMP} ${p.className ?? ''}`} />;
}

export function Zone(p: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea {...p} className={`py-2.5 leading-relaxed resize-none ${CHAMP} ${p.className ?? ''}`} />;
}

export function Choix(p: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return <select {...p} className={`h-10 ${CHAMP} cursor-pointer ${p.className ?? ''}`} />;
}

export function Libelle({ children, detail }: { readonly children: ReactNode; readonly detail?: string }): ReactNode {
  return (
    <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-bold text-encre-douce">
      {children}
      {detail && <span className="font-mono text-[11px] font-normal text-discret">{detail}</span>}
    </span>
  );
}
