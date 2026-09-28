// Responsabilité : le rendu d'un appel d'outil et d'un sous-agent dans le fil, dépliables pour tout voir.
import { Bot, ChevronRight, FileText, Globe, Pencil, Search, SquareTerminal, Wrench } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { Tag } from '../../shared/ui/elements.tsx';
import type { ElementOutil, ElementSousAgent } from './structure.ts';

const ICONES: Record<string, ReactNode> = {
  Bash: <SquareTerminal size={14} />, Read: <FileText size={14} />, Edit: <Pencil size={14} />, Write: <Pencil size={14} />,
  Grep: <Search size={14} />, Glob: <Search size={14} />, WebFetch: <Globe size={14} />, WebSearch: <Globe size={14} />,
};

// Dossier de travail de la session : les chemins qui y mènent sont affichés relatifs, lisibles d'un coup d'œil.
export const ContexteDossier = createContext('');

function raccourcir(texte: string, dossier: string): string {
  return dossier ? texte.split(`${dossier}/`).join('') : texte;
}

function Depliable({ entete, children, defaut = false }: { readonly entete: ReactNode; readonly children: ReactNode; readonly defaut?: boolean }): ReactNode {
  const [ouvert, setOuvert] = useState(defaut);
  return (
    <div>
      <button type="button" onClick={() => setOuvert(!ouvert)} className="group flex w-full min-w-0 cursor-pointer items-center gap-2 text-left">
        <ChevronRight size={14} className={`shrink-0 text-discret transition-transform duration-200 ${ouvert ? 'rotate-90' : ''}`} />
        {entete}
      </button>
      <AnimatePresence initial={false}>
        {ouvert && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }} className="overflow-hidden">
            <div className="pt-2 pl-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Bloc({ titre, texte, erreur }: { readonly titre: string; readonly texte: string; readonly erreur?: boolean }): ReactNode {
  return (
    <div className="mb-2">
      <div className="mb-1 font-mono text-[10.5px] tracking-[0.12em] text-discret uppercase">{titre}</div>
      <pre className={`max-h-72 overflow-auto rounded-[10px] px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap
        break-words ${erreur ? 'bg-danger-fond text-danger' : 'bg-surface-2 text-encre-douce'}`}>{texte || '—'}</pre>
    </div>
  );
}

export function CarteOutil({ el }: { readonly el: ElementOutil }): ReactNode {
  const { outil, resultat } = el;
  const dossier = useContext(ContexteDossier);
  const enCours = resultat === null;
  return (
    <div className="rounded-[12px] px-2.5 py-1.5 hover:bg-surface-2/60">
      <Depliable entete={
        <span className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className={`shrink-0 ${resultat?.erreur ? 'text-danger' : 'text-accent-texte'}`}>{ICONES[outil.nom] ?? <Wrench size={14} />}</span>
          <span className="shrink-0 font-bold">{outil.nom}</span>
          <span className="truncate font-mono text-[12px] text-discret">{raccourcir(outil.resume, dossier)}</span>
          {enCours && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent-vif" />}
        </span>
      }>
        <Bloc titre="Entrée" texte={outil.detail} />
        {resultat && <Bloc titre={resultat.erreur ? 'Erreur' : 'Résultat'} texte={resultat.extrait} erreur={resultat.erreur} />}
      </Depliable>
    </div>
  );
}

export function CarteSousAgent({ el }: { readonly el: ElementSousAgent }): ReactNode {
  const fini = el.resultat !== null;
  const outils = el.interieur.filter((i) => i.genre === 'outil').length;
  const rapport = el.interieur.findLast((i) => i.genre === 'texte');
  return (
    <div className="my-1.5 rounded-[16px] bg-surface p-3 ombre-carte">
      <Depliable entete={
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-accent-fond text-accent-texte"><Bot size={15} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{el.agent.description || 'Sous-agent'}</span>
            <span className="block font-mono text-[11px] text-discret">{el.agent.genre} · {outils} outil{outils > 1 ? 's' : ''}</span>
          </span>
          <Tag ton={fini ? 'succes' : 'accent'}>{fini ? 'terminé' : 'en cours'}</Tag>
          {el.agent.modele && <Tag ton="neutre">{el.agent.modele}</Tag>}
        </span>
      }>
        <div className="space-y-0.5 border-l-2 border-accent-fond pl-3">
          {el.interieur.map((i) => i.genre === 'outil'
            ? <CarteOutil key={i.seq} el={i} />
            : i !== rapport && <p key={i.seq} className="px-2.5 py-1 text-[13px] text-encre-douce">{i.evt.texte.slice(0, 600)}</p>)}
          {rapport && rapport.genre === 'texte' && <Bloc titre={fini ? 'Rapport rendu' : 'Dernier message'} texte={rapport.evt.texte} />}
          {el.resultat?.erreur && <Bloc titre="Fin en erreur" texte={el.resultat.extrait} erreur />}
        </div>
      </Depliable>
    </div>
  );
}
