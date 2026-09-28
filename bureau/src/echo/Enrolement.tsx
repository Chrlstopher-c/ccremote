// Responsabilité : sous l'orbe, l'enregistrement de la voix de Chris en cours — consigne, progression, annulation.
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export function Enrolement(p: {
  readonly duree: number;
  readonly cible: number;
  readonly annuler: () => void;
}): ReactNode {
  const part = Math.min(1, p.duree / p.cible);
  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-2.5 px-6 text-center">
      <p className="font-mono text-[11px] tracking-[.12em] text-accent-texte uppercase">Enregistrement de ta voix</p>
      <p className="text-[15px] font-semibold text-encre">Parle normalement, de ce que tu veux. Seul dans la pièce.</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-champ">
        <motion.div
          className="h-full rounded-full bg-accent"
          animate={{ width: `${part * 100}%` }}
          transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
        />
      </div>
      <div className="flex w-full items-center justify-between font-mono text-[11px] text-discret">
        <span>
          {Math.round(p.duree)} / {p.cible} s
        </span>
        <button type="button" onClick={p.annuler} className="cursor-default hover:text-encre">
          Annuler
        </button>
      </div>
    </div>
  );
}
