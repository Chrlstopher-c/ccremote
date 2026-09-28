// Responsabilité : la zone des cadres d'Echo — cartes apparues à côté de l'orbe, retirables, disposées en grille.
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { CadreEcho } from '../../../../commun/echo.ts';
import { ContenuCadre } from './rendus.tsx';

const LARGE: ReadonlySet<CadreEcho['genre']> = new Set(['web', 'svg', 'image']);

const CARTE =
  'flex min-h-0 flex-col rounded-[14px] border border-filet ' +
  'bg-fond p-3 shadow-[0_1px_0_var(--filet),0_18px_40px_-24px_rgba(20,10,40,.35)]';
const GRILLE =
  'grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(300px,1fr))] content-start gap-3 overflow-y-auto p-4';
const FERMER =
  'grid size-6 cursor-default place-items-center rounded-[6px] text-discret hover:bg-survol hover:text-encre';

function Carte({ c, retirer }: { readonly c: CadreEcho; readonly retirer: (id: string) => void }): ReactNode {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
      className={`${CARTE} ${LARGE.has(c.genre) ? 'col-span-full' : ''}`}
    >
      <header className="mb-2 flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-[2px] bg-accent" />
        <h2 className="min-w-0 flex-1 truncate font-mono text-[11px] tracking-[.1em] text-accent-texte uppercase">
          {c.titre}
        </h2>
        <button
          type="button"
          onClick={() => retirer(c.id)}
          aria-label={`Retirer ${c.titre}`}
          title="Retirer"
          className={FERMER}
        >
          <X size={13} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <ContenuCadre c={c} />
      </div>
    </motion.article>
  );
}

export function Cadres({
  cadres,
  retirer,
}: {
  readonly cadres: readonly CadreEcho[];
  readonly retirer: (id: string) => void;
}): ReactNode {
  return (
    <div className={GRILLE}>
      <AnimatePresence mode="popLayout">
        {cadres.map((c) => (
          <Carte key={c.id} c={c} retirer={retirer} />
        ))}
      </AnimatePresence>
    </div>
  );
}
