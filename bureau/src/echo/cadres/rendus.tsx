// Responsabilité : rendre le contenu d'un cadre d'Echo selon son genre — sans jamais exécuter ce qu'elle envoie
// (Markdown sans HTML brut, SVG en image, page web en iframe isolée).
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CadreEcho } from '../../../../commun/echo.ts';
import { ouvrirLien } from '../../shared/natif.ts';

const CODE =
  'selectionnable max-h-[60vh] overflow-auto rounded-[8px] bg-champ p-3 font-mono text-[12px] leading-relaxed text-encre';
const LIEN =
  'flex cursor-default items-center gap-1 self-start font-mono text-[10.5px] text-discret hover:text-accent-texte';
const MEDIA = 'mx-auto max-h-[60vh] w-full object-contain';

function Texte({ md }: { readonly md: string }): ReactNode {
  return (
    <div className="prose-fil selectionnable text-[13px] text-encre">
      <Markdown remarkPlugins={[remarkGfm]}>{md}</Markdown>
    </div>
  );
}

function Stats({ c }: { readonly c: CadreEcho }): ReactNode {
  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
        {(c.stats ?? []).map((s) => (
          <div key={s.libelle} className="rounded-[10px] bg-champ px-3 py-2.5">
            <div className="font-mono text-[10.5px] tracking-[.08em] text-discret uppercase">{s.libelle}</div>
            <div className="mt-0.5 text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-encre">
              {s.valeur}
            </div>
            {s.detail && <div className="mt-0.5 text-[11.5px] text-encre-2">{s.detail}</div>}
          </div>
        ))}
      </div>
      {c.contenu && <p className="mt-2 text-[12px] text-discret">{c.contenu}</p>}
    </div>
  );
}

// Le SVG d'Echo passe par <img> : aucun script, aucun accès au document.
function Svg({ svg }: { readonly svg: string }): ReactNode {
  return (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt=""
      className="mx-auto max-h-[60vh] w-full object-contain"
    />
  );
}

function Web({ url }: { readonly url: string }): ReactNode {
  return (
    <div className="flex h-full min-h-[320px] flex-col gap-1.5">
      <iframe
        src={url}
        title={url}
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 rounded-[8px] border border-filet bg-white"
      />
      <button type="button" onClick={() => void ouvrirLien(url)} className={LIEN}>
        <ExternalLink size={11} /> {url.replace(/^https?:\/\//, '').slice(0, 70)} — ouvrir si la page refuse
        l'intégration
      </button>
    </div>
  );
}

function Code({ c }: { readonly c: CadreEcho }): ReactNode {
  return (
    <pre className={CODE}>
      {c.langue && <div className="mb-1 text-[10px] text-discret uppercase">{c.langue}</div>}
      {c.contenu}
    </pre>
  );
}

export function ContenuCadre({ c }: { readonly c: CadreEcho }): ReactNode {
  switch (c.genre) {
    case 'markdown':
      return <Texte md={c.contenu} />;
    case 'stats':
      return <Stats c={c} />;
    case 'svg':
      return <Svg svg={c.contenu} />;
    case 'web':
      return <Web url={c.contenu} />;
    case 'image':
      return <img src={c.contenu} alt={c.titre} className={`${MEDIA} rounded-[8px]`} />;
    case 'code':
      return <Code c={c} />;
  }
}
