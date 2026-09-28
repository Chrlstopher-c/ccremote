// Responsabilité : les événements simples du fil — message de Chris, texte de Claude, jalons, signaux. Sobre, dense.
import { CircleCheck, CircleHelp, Flag, Minimize2, RotateCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Evenement } from '../../../../commun/session.ts';
import { heure, tokens } from '../../shared/format.ts';

function Jalon({ icone, couleur, titre, texte }: {
  readonly icone: ReactNode;
  readonly couleur: string;
  readonly titre: string;
  readonly texte: string;
}): ReactNode {
  return (
    <div className={`my-2 border-l-2 py-0.5 pl-3 ${couleur}`}>
      <div className="flex items-center gap-1.5 text-[12px] font-bold">{icone}{titre}</div>
      <div className="selectionnable mt-0.5 text-[13px] whitespace-pre-wrap text-encre">{texte}</div>
    </div>
  );
}

function Signal({ icone, texte }: { readonly icone: ReactNode; readonly texte: string }): ReactNode {
  return (
    <div className="my-1.5 flex items-center gap-1.5 font-mono text-[10.5px] text-discret">
      {icone}{texte}
    </div>
  );
}

function Message({ texte, ts }: { readonly texte: string; readonly ts: string }): ReactNode {
  return (
    <div className="my-3 rounded-[6px] bg-accent-fond px-3 py-2">
      <div className="mb-0.5 flex justify-between font-mono text-[10.5px] text-accent-texte">
        <span>chris</span><span>{heure(ts)}</span>
      </div>
      <div className="selectionnable text-[13px] whitespace-pre-wrap text-encre">{texte}</div>
    </div>
  );
}

export function ElementSimple({ evt, ts }: { readonly evt: Evenement; readonly ts: string }): ReactNode {
  switch (evt.type) {
    case 'message':
      return <Message texte={evt.texte} ts={ts} />;
    case 'texte':
      return (
        <div className="prose-fil selectionnable my-2 text-[13px] text-encre">
          <Markdown remarkPlugins={[remarkGfm]}>{evt.texte}</Markdown>
        </div>
      );
    case 'reflexion':
      return <p className="selectionnable my-1 text-[12px] text-discret italic">{evt.texte.slice(0, 1_200)}</p>;
    case 'etape':
      return <Jalon icone={<Flag size={12} />} couleur="border-accent text-accent-texte" titre="Étape livrée"
        texte={`${evt.resume}\n→ ${evt.suite}`} />;
    case 'objectif_atteint':
      return <Jalon icone={<CircleCheck size={12} />} couleur="border-succes text-succes" titre="Objectif atteint"
        texte={evt.bilan} />;
    case 'question':
      return <Jalon icone={<CircleHelp size={12} />} couleur="border-alerte text-alerte" titre="Question"
        texte={evt.question} />;
    case 'erreur':
      return <Jalon icone={<TriangleAlert size={12} />} couleur="border-danger text-danger" titre="Erreur"
        texte={evt.message} />;
    case 'compaction':
      return <Signal icone={<Minimize2 size={10} />}
        texte={`compactée · ${tokens(evt.avant)} → ${tokens(evt.apres)}`} />;
    case 'relance':
      return <Signal icone={<RotateCw size={10} />} texte={evt.raison} />;
    default:
      return null;
  }
}
