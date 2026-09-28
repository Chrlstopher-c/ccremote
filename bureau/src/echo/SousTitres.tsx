// Responsabilité : sous l'orbe, ce qu'Echo vient d'entendre et ce qu'elle est en train de dire.
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { Entendu } from './useEcho.ts';

/** La fin de la réponse en cours : ce qui se dit maintenant, pas tout le paragraphe. */
function derniersMots(texte: string): string {
  const t = texte.replace(/\s+/g, ' ').trim();
  return t.length > 180 ? `…${t.slice(-180)}` : t;
}

/** Ressemblance de la phrase avec la voix de Chris : reconnue, ou ignorée (autre voix). */
function Score({ e }: { readonly e: Entendu }): ReactNode {
  if (e.score === null) return null;
  const ton = e.refusee ? 'text-danger' : 'text-succes';
  return (
    <span className={`ml-2 ${ton}`}>
      voix {e.score.toFixed(2)}
      {e.refusee ? ' · ignorée' : ''}
    </span>
  );
}

export function SousTitres(p: { readonly entendu: Entendu | null; readonly dit: string }): ReactNode {
  return (
    <div className="flex min-h-[84px] w-full max-w-[640px] flex-col items-center gap-2 px-6 text-center">
      <AnimatePresence mode="wait">
        {p.entendu && (
          <motion.p
            key={p.entendu.texte}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: p.entendu.eveil ? 1 : 0.45, y: 0 }}
            exit={{ opacity: 0 }}
            className="font-mono text-[11.5px] text-discret"
          >
            « {p.entendu.texte} »
            <Score e={p.entendu} />
          </motion.p>
        )}
      </AnimatePresence>
      {p.dit && (
        <p className="text-[16px] leading-snug font-semibold tracking-[-0.01em] text-encre">{derniersMots(p.dit)}</p>
      )}
    </div>
  );
}
