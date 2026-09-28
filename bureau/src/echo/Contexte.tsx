// Responsabilité : le contexte de la session d'Echo — jauge (avec les seuils d'autocompact), compactions, et
// compaction à la demande.
import { Minimize2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ContexteEcho } from '../../../commun/echo.ts';
import { heure } from '../shared/format.ts';

const k = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : `${Math.round(n / 1000)} k`);
const BOUTON =
  'mt-2 flex h-8 cursor-default items-center gap-1.5 rounded-[10px] border border-filet px-3 text-[12.5px] ' +
  'font-bold text-encre hover:bg-survol disabled:opacity-40';

function Jauge({ c }: { readonly c: ContexteEcho }): ReactNode {
  const pct = (n: number): string => `${Math.min(100, (n / c.fenetre) * 100)}%`;
  const ton = c.tokens >= c.seuilDur ? 'bg-danger' : c.tokens >= c.seuilRepos ? 'bg-alerte' : 'bg-accent';
  return (
    <div
      className="relative mt-1.5 h-1.5 w-full rounded-full bg-champ"
      title="Seuils : compaction au repos, puis en fin de tour"
    >
      <div className={`h-full rounded-full ${ton}`} style={{ width: pct(c.tokens) }} />
      <span className="absolute top-[-2px] h-2.5 w-px bg-alerte" style={{ left: pct(c.seuilRepos) }} />
      <span className="absolute top-[-2px] h-2.5 w-px bg-danger" style={{ left: pct(c.seuilDur) }} />
    </div>
  );
}

export function Contexte({
  c,
  compacter,
}: {
  readonly c: ContexteEcho | null;
  readonly compacter: () => void;
}): ReactNode {
  if (!c) return null;
  return (
    <div className="mt-3 border-t border-filet pt-2.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[.1em] text-discret uppercase">Contexte</span>
        <span className="font-mono text-[11px] text-encre">
          {k(c.tokens)} / {k(c.fenetre)}
        </span>
      </div>
      <Jauge c={c} />
      <p className="mt-1.5 text-[11px] leading-snug text-discret">
        {c.compactions} compaction{c.compactions > 1 ? 's' : ''}
        {c.derniere ? ` · dernière à ${heure(c.derniere)}` : ''} · auto au repos dès {k(c.seuilRepos)}, en fin de tour
        dès {k(c.seuilDur)}.
      </p>
      <button type="button" onClick={compacter} disabled={c.enCours} className={BOUTON}>
        <Minimize2 size={13} /> {c.enCours ? 'Compaction en cours…' : 'Compacter maintenant'}
      </button>
    </div>
  );
}
