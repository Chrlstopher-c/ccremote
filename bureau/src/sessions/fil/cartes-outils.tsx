// Responsabilité : un appel d'outil et un sous-agent dans le fil — une rangée compacte qui se déplie pour tout voir.
import { Bot, ChevronRight, FileText, Globe, Pencil, Search, SquareTerminal, Wrench } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { Point } from '../../shared/ui/elements.tsx';
import { ApercuFichiers } from './ApercuFichiers.tsx';
import { cheminsPresentes } from './fichiers-presentes.ts';
import type { ElementOutil, ElementSousAgent } from './structure.ts';

const ICONES: Record<string, ReactNode> = {
  Bash: <SquareTerminal size={12} />, Read: <FileText size={12} />,
  Edit: <Pencil size={12} />, Write: <Pencil size={12} />,
  Grep: <Search size={12} />, Glob: <Search size={12} />, WebFetch: <Globe size={12} />, WebSearch: <Globe size={12} />,
};

// Dossier de travail de la session : les chemins qui y mènent sont affichés relatifs.
export const ContexteDossier = createContext('');

function raccourcir(texte: string, dossier: string): string {
  return dossier ? texte.split(`${dossier}/`).join('') : texte;
}

function Rangee({ ouvert, basculer, children }: {
  readonly ouvert: boolean;
  readonly basculer: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <button type="button" onClick={basculer}
      className={`flex h-6 w-full min-w-0 cursor-default
        items-center gap-1.5 rounded-[4px] px-1 text-left hover:bg-survol`}>
      <ChevronRight size={11} className={`shrink-0 text-discret transition-transform ${ouvert ? 'rotate-90' : ''}`} />
      {children}
    </button>
  );
}

interface PropsBloc {
  readonly titre: string;
  readonly texte: string;
  readonly erreur?: boolean;
}

function Bloc({ titre, texte, erreur }: PropsBloc): ReactNode {
  const ton = erreur ? 'bg-danger/10 text-danger' : 'bg-champ text-encre-2';
  return (
    <div className="mt-1 mb-1.5 ml-4">
      <div className="etiquette pb-0.5">{titre}</div>
      <pre className={`selectionnable max-h-64 overflow-auto rounded-[5px] px-2.5 py-1.5 font-mono text-[11.5px]
        leading-relaxed whitespace-pre-wrap break-words ${ton}`}>
        {texte || '—'}
      </pre>
    </div>
  );
}

export function CarteOutil({ el }: { readonly el: ElementOutil }): ReactNode {
  const [ouvert, setOuvert] = useState(false);
  const dossier = useContext(ContexteDossier);
  const { outil, resultat } = el;
  return (
    <div>
      <Rangee ouvert={ouvert} basculer={() => setOuvert(!ouvert)}>
        <span className={`shrink-0 ${resultat?.erreur ? 'text-danger' : 'text-discret'}`}>
          {ICONES[outil.nom] ?? <Wrench size={12} />}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] font-medium text-encre-2">{outil.nom}</span>
        <span className="truncate font-mono text-[11.5px] text-discret">{raccourcir(outil.resume, dossier)}</span>
        {resultat === null && <span className="ml-auto pr-1"><Point ton="actif" /></span>}
      </Rangee>
      {resultat && !resultat.erreur && <ApercuFichiers chemins={cheminsPresentes(outil.nom, outil.detail, dossier)} />}
      {ouvert && <Bloc titre="entrée" texte={outil.detail} />}
      {ouvert && resultat && (
        <Bloc titre={resultat.erreur ? 'erreur' : 'résultat'} texte={resultat.extrait} erreur={resultat.erreur} />
      )}
    </div>
  );
}

// Le dernier texte du sous-agent est son rapport : il est mis à part, le reste raconte son chemin.
export function CarteSousAgent({ el }: { readonly el: ElementSousAgent }): ReactNode {
  const [ouvert, setOuvert] = useState(false);
  const fini = el.resultat !== null;
  const outils = el.interieur.filter((i) => i.genre === 'outil').length;
  const rapport = el.interieur.findLast((i) => i.genre === 'texte');
  return (
    <div className="my-1 rounded-[6px] border border-filet">
      <Rangee ouvert={ouvert} basculer={() => setOuvert(!ouvert)}>
        <Bot size={12} className="shrink-0 text-accent-texte" />
        <span className="truncate text-[12.5px] font-semibold">{el.agent.description || 'Sous-agent'}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-discret">
          {`${el.agent.genre} · ${outils} outil${outils > 1 ? 's' : ''}`}
          {el.agent.modele ? ` · ${el.agent.modele}` : ''}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-1 font-mono text-[10.5px] text-discret">
          <Point ton={fini ? 'calme' : 'actif'} />{fini ? 'terminé' : 'en cours'}
        </span>
      </Rangee>
      {ouvert && (
        <div className="border-t border-filet px-2 py-1">
          {el.interieur.map((i) => (i.genre === 'outil' ? <CarteOutil key={i.seq} el={i} /> : null))}
          {rapport?.genre === 'texte' && (
            <Bloc titre={fini ? 'rapport' : 'dernier message'} texte={rapport.evt.texte} />
          )}
          {el.resultat?.erreur && <Bloc titre="fin en erreur" texte={el.resultat.extrait} erreur />}
        </div>
      )}
    </div>
  );
}
