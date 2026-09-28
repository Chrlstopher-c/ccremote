// Responsabilité : la fenêtre modale de l'app (ouverture de session, confirmations).
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect } from 'react';

interface Props {
  readonly ouvert: boolean;
  readonly surFermer: () => void;
  readonly titre: string;
  readonly surtitre?: string;
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

export function Dialogue({ ouvert, surFermer, titre, surtitre, largeur = 560, children }: Props): ReactNode {
  useEchap(ouvert, surFermer);
  return (
    <AnimatePresence>
      {ouvert && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-night/45 p-6 backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          onMouseDown={(e) => e.target === e.currentTarget && surFermer()}>
          <motion.div role="dialog" aria-modal="true" aria-label={titre} style={{ maxWidth: largeur }}
            className="w-full rounded-[var(--radius-panneau)] bg-surface p-7 ombre-menu"
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}>
            {surtitre && <div className="surtitre mb-2">{surtitre}</div>}
            <h2 className="mb-5 text-[22px] font-extrabold tracking-[-0.03em]">{titre}</h2>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
