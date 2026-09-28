// Responsabilité : le tiroir de discussion du mode Echo — l'historique écrit et la saisie clavier, masqués par défaut.
import { CornerDownLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EntreeHistoriqueEcho } from '../../../commun/echo.ts';
import { heure } from '../shared/format.ts';

function Entree({ e }: { readonly e: EntreeHistoriqueEcho }): ReactNode {
  if (e.qui === 'quart') {
    return (
      <div className="my-2 border-l-2 border-filet pl-2.5 font-mono text-[10.5px] whitespace-pre-wrap text-discret">
        {e.texte}
      </div>
    );
  }
  if (e.qui === 'chris') {
    const voix = e.origine.startsWith('voix:') ? ' · voix' : '';
    return (
      <div className="my-2.5 rounded-[10px] bg-accent-fond px-3 py-2">
        <div className="mb-0.5 flex justify-between font-mono text-[10px] text-accent-texte">
          <span>chris{voix}</span>
          <span>{heure(e.ts)}</span>
        </div>
        <div className="selectionnable text-[13px] whitespace-pre-wrap text-encre">{e.texte}</div>
      </div>
    );
  }
  return (
    <div className="prose-fil selectionnable my-2 text-[13px] text-encre">
      <Markdown remarkPlugins={[remarkGfm]}>{e.texte}</Markdown>
    </div>
  );
}

const ZONE =
  'min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed outline-none select-text ' +
  'placeholder:text-discret';
const ENVOI = 'grid size-7 cursor-default place-items-center rounded-[8px] bg-accent text-white disabled:opacity-30';

function useSaisie(envoyer: (t: string) => Promise<boolean>) {
  const [texte, setTexte] = useState('');
  const soumettre = async (): Promise<void> => {
    const t = texte.trim();
    if (t && (await envoyer(t))) setTexte('');
  };
  const touche = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    void soumettre();
  };
  return { texte, setTexte, soumettre, touche };
}

function Saisie({ envoyer }: { readonly envoyer: (t: string) => Promise<boolean> }): ReactNode {
  const s = useSaisie(envoyer);
  return (
    <div className="flex shrink-0 items-end gap-2 border-t border-filet px-3 py-2.5">
      <textarea
        autoFocus
        value={s.texte}
        onChange={(e) => s.setTexte(e.target.value)}
        onKeyDown={s.touche}
        rows={Math.min(6, Math.max(1, s.texte.split('\n').length))}
        placeholder="Écrire à Echo"
        aria-label="Message à Echo"
        className={ZONE}
      />
      <button
        type="button"
        onClick={() => void s.soumettre()}
        disabled={!s.texte.trim()}
        title="Envoyer (Entrée)"
        aria-label="Envoyer"
        className={ENVOI}
      >
        <CornerDownLeft size={14} />
      </button>
    </div>
  );
}

export function Discussion(props: {
  readonly historique: readonly EntreeHistoriqueEcho[];
  readonly envoyer: (t: string) => Promise<boolean>;
}): ReactNode {
  const bas = useRef<HTMLDivElement>(null);
  useEffect(() => bas.current?.scrollIntoView({ block: 'end' }), [props.historique]);
  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
      className="flex w-[360px] shrink-0 flex-col border-l border-filet bg-cote"
    >
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {props.historique.map((e) => (
          <Entree key={`${e.ts}-${e.qui}`} e={e} />
        ))}
        <div ref={bas} />
      </div>
      <Saisie envoyer={props.envoyer} />
    </motion.aside>
  );
}
