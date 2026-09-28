// Responsabilité : la vue Echo — la conversation avec le chef d'orchestre, au clavier, depuis l'app ou le web.
import { AudioLines, CornerDownLeft, Radio, Square } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EntreeHistoriqueEcho } from '../../../commun/echo.ts';
import { heure } from '../shared/format.ts';
import { type Disponibilite, type EnCours, useEcho } from './useEcho.ts';

const ETATS: Record<Disponibilite, string> = {
  chargement: 'connexion…',
  ok: 'à l’écoute',
  injoignable: 'injoignable',
  absente: 'non configurée sur ce relais',
};

function Entree({ e }: { readonly e: EntreeHistoriqueEcho }): ReactNode {
  const voix = e.origine.startsWith('voix:') ? ` · ${e.origine.slice(5)} (voix)` : '';
  if (e.qui === 'quart') {
    return (
      <div className="my-2 border-l-2 border-filet py-0.5 pl-3 font-mono text-[11px] whitespace-pre-wrap text-discret">
        {e.texte}
      </div>
    );
  }
  if (e.qui === 'chris') {
    return (
      <div className="my-3 rounded-[6px] bg-accent-fond px-3 py-2">
        <div className="mb-0.5 flex justify-between font-mono text-[10.5px] text-accent-texte">
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

function ReponseEnCours({ enCours }: { readonly enCours: EnCours }): ReactNode {
  return (
    <div className="my-2">
      {enCours.outils.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1 font-mono text-[10.5px] text-discret">
          {enCours.outils.map((o, i) => (
            <span key={`${o}-${i}`} className="rounded-[4px] border border-filet px-1.5">
              {o.replace(/^mcp__/, '')}
            </span>
          ))}
        </div>
      )}
      <div className="prose-fil selectionnable text-[13px] text-encre">
        <Markdown remarkPlugins={[remarkGfm]}>{enCours.texte || '…'}</Markdown>
      </div>
    </div>
  );
}

function Composeur(props: {
  readonly occupe: boolean;
  readonly envoyer: (t: string) => Promise<boolean>;
  readonly interrompre: () => Promise<void>;
}): ReactNode {
  const [texte, setTexte] = useState('');
  const soumettre = async (): Promise<void> => {
    const t = texte.trim();
    if (t && (await props.envoyer(t))) setTexte('');
  };
  const touche = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    void soumettre();
  };
  return (
    <div className="flex shrink-0 items-end gap-2 border-t border-filet px-4 py-2.5">
      <textarea value={texte} onChange={(e) => setTexte(e.target.value)} onKeyDown={touche} aria-label="Message à Echo"
        rows={Math.min(8, Math.max(1, texte.split('\n').length))} placeholder="Parler à Echo"
        className="min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed outline-none
          select-text placeholder:text-discret" />
      {props.occupe && (
        <button type="button" onClick={() => void props.interrompre()} title="Interrompre Echo" aria-label="Stop"
          className="grid size-7 cursor-default place-items-center rounded-[6px] border border-filet text-encre">
          <Square size={12} />
        </button>
      )}
      <button type="button" onClick={() => void soumettre()} disabled={!texte.trim()} title="Envoyer (Entrée)"
        aria-label="Envoyer"
        className="grid size-7 cursor-default place-items-center rounded-[6px] bg-accent text-white disabled:opacity-30">
        <CornerDownLeft size={14} />
      </button>
    </div>
  );
}

export function VueEcho(): ReactNode {
  const echo = useEcho();
  const bas = useRef<HTMLDivElement>(null);
  useEffect(() => bas.current?.scrollIntoView({ block: 'end' }), [echo.historique, echo.enCours]);
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-fond">
      <header className="flex shrink-0 items-center gap-2 border-b border-filet px-4 py-2.5">
        <AudioLines size={15} className="text-accent-texte" />
        <h1 className="text-[13px] font-bold text-encre">Echo</h1>
        <span className="flex items-center gap-1 font-mono text-[10.5px] text-discret">
          <Radio size={10} className={echo.occupe ? 'animate-pulse text-accent-texte' : ''} />
          {echo.occupe ? 'réfléchit' : ETATS[echo.dispo]}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {echo.historique.map((e) => <Entree key={`${e.ts}-${e.qui}`} e={e} />)}
        {echo.occupe && <ReponseEnCours enCours={echo.enCours} />}
        <div ref={bas} />
      </div>
      <Composeur occupe={echo.occupe} envoyer={echo.envoyer} interrompre={echo.interrompre} />
    </section>
  );
}
