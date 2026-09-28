// Responsabilité : le rendu des événements simples du fil — messages, texte de Claude, jalons, signaux.
import { CircleCheck, CircleHelp, Flag, Minimize2, RotateCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Evenement } from '../../../../commun/session.ts';
import { heure, tokens } from '../../shared/format.ts';

type Ton = 'accent' | 'succes' | 'alerte' | 'danger';
const TONS: Record<Ton, string> = {
  accent: 'bg-accent-fond text-accent-texte',
  succes: 'bg-succes-fond text-succes',
  alerte: 'bg-alerte-fond text-alerte',
  danger: 'bg-danger-fond text-danger',
};

interface PropsJalon {
  readonly icone: ReactNode;
  readonly ton: Ton;
  readonly titre: string;
  readonly texte: string;
}

function Jalon({ icone, ton, titre, texte }: PropsJalon): ReactNode {
  return (
    <div className={`my-2 flex gap-3 rounded-[14px] px-4 py-3 ${TONS[ton]}`}>
      <span className="mt-0.5 shrink-0">{icone}</span>
      <div className="min-w-0">
        <div className="text-[13px] font-extrabold">{titre}</div>
        <div className="mt-0.5 text-[14px] leading-relaxed whitespace-pre-wrap text-encre">{texte}</div>
      </div>
    </div>
  );
}

function Filet({ icone, texte }: { readonly icone: ReactNode; readonly texte: string }): ReactNode {
  return (
    <div className="my-2 flex items-center gap-3 font-mono text-[11px] text-discret">
      <span className="h-px flex-1 bg-filet" />
      <span className="flex items-center gap-1.5">{icone}{texte}</span>
      <span className="h-px flex-1 bg-filet" />
    </div>
  );
}

function Message({ texte, ts }: { readonly texte: string; readonly ts: string }): ReactNode {
  return (
    <div className="my-3 flex justify-end">
      <div className={`max-w-[78%] rounded-[18px] rounded-br-[6px] bg-accent px-4
        py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-white`}>
        {texte}
        <div className="mt-1 text-right font-mono text-[10px] opacity-70">{heure(ts)}</div>
      </div>
    </div>
  );
}

function Parole({ evt }: { readonly evt: Evenement }): ReactNode {
  if (evt.type === 'texte') {
    return <div className={`prose-fil my-2
      px-1 text-[14.5px] text-encre`}><Markdown remarkPlugins={[remarkGfm]}>{evt.texte}</Markdown></div>;
  }
  if (evt.type === 'reflexion') {
    return <p className={`my-1.5 border-l-2 border-filet-fort px-3
      text-[13px] leading-relaxed text-discret italic`}>{evt.texte.slice(0, 1_200)}</p>;
  }
  return null;
}

function Signal({ evt }: { readonly evt: Evenement }): ReactNode {
  switch (evt.type) {
    case 'etape':
      return <Jalon icone={<Flag size={16} />} ton="accent" titre="Étape livrée"
        texte={`${evt.resume}\n→ ${evt.suite}`} />;
    case 'objectif_atteint':
      return <Jalon icone={<CircleCheck size={16} />} ton="succes" titre="Objectif atteint" texte={evt.bilan} />;
    case 'question':
      return <Jalon icone={<CircleHelp size={16} />} ton="alerte" titre="Question pour toi" texte={evt.question} />;
    case 'erreur':
      return <Jalon icone={<TriangleAlert size={16} />} ton="danger" titre="Erreur" texte={evt.message} />;
    case 'compaction':
      return <Filet icone={<Minimize2 size={11} />}
        texte={`compactée · ${tokens(evt.avant)} → ${tokens(evt.apres)}`} />;
    case 'relance':
      return <Filet icone={<RotateCw size={11} />} texte={evt.raison} />;
    default:
      return null;
  }
}

export function ElementSimple({ evt, ts }: { readonly evt: Evenement; readonly ts: string }): ReactNode {
  if (evt.type === 'message') return <Message texte={evt.texte} ts={ts} />;
  if (evt.type === 'texte' || evt.type === 'reflexion') return <Parole evt={evt} />;
  return <Signal evt={evt} />;
}
