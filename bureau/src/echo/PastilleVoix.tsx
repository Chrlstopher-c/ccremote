// Responsabilité : l'empreinte vocale dans la barre du mode Echo — son état en un coup d'œil, et ce qu'on peut en faire
// (l'enregistrer, la refaire, l'oublier).
import { Fingerprint } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import type { CommandeVoix, EtatVoixEcho } from '../../../commun/echo.ts';

const PASTILLE = 'flex h-8 cursor-default items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold';
const PANNEAU =
  'absolute top-10 right-0 z-20 w-[280px] rounded-[14px] border border-filet bg-fond p-3 ' +
  'shadow-[0_1px_0_var(--filet),0_24px_48px_-24px_rgba(20,10,40,.5)]';
const ACTION = 'h-8 cursor-default rounded-[10px] px-3 text-[12.5px] font-bold';

function libelle(v: EtatVoixEcho | null): { texte: string; ton: string } {
  if (!v || v.profil === null) return { texte: 'voix : …', ton: 'border-filet text-discret' };
  if (v.enrolement) return { texte: 'enregistrement…', ton: 'border-accent text-accent-texte' };
  return v.profil
    ? { texte: 'voix reconnue', ton: 'border-filet text-succes' }
    : { texte: 'voix non enregistrée', ton: 'border-alerte text-alerte' };
}

function Panneau(p: { readonly v: EtatVoixEcho | null; readonly agir: (a: CommandeVoix) => void }): ReactNode {
  const profil = p.v?.profil === true;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
      className={PANNEAU}
    >
      <p className="text-[12.5px] leading-relaxed text-encre-2">
        {profil
          ? `Echo n'obéit qu'à ta voix (seuil ${p.v?.seuil ?? '—'}). Les autres voix sont ignorées.`
          : 'Sans empreinte, Echo obéit à toute voix qui dit « Écho ». Enregistre-toi seul dans la pièce : ~30 s de parole.'}
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => p.agir('enroler')} className={`${ACTION} bg-accent text-white`}>
          {profil ? 'Réenregistrer' : 'Enregistrer ma voix'}
        </button>
        {profil && (
          <button
            type="button"
            onClick={() => p.agir('oublier')}
            className={`${ACTION} border border-filet text-encre hover:bg-survol`}
          >
            Oublier
          </button>
        )}
      </div>
      {p.v && <p className="mt-2 font-mono text-[10px] text-discret">terminal : {p.v.terminal}</p>}
    </motion.div>
  );
}

export function PastilleVoix(p: {
  readonly voix: EtatVoixEcho | null;
  readonly commander: (a: CommandeVoix) => void;
}): ReactNode {
  const [ouvert, setOuvert] = useState(false);
  const l = libelle(p.voix);
  const agir = (a: CommandeVoix): void => {
    p.commander(a);
    setOuvert(false);
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className={`${PASTILLE} ${l.ton}`}
      >
        <Fingerprint size={13} />
        {l.texte}
      </button>
      <AnimatePresence>{ouvert && <Panneau v={p.voix} agir={agir} />}</AnimatePresence>
    </div>
  );
}
