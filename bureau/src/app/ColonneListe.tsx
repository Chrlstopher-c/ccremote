// Responsabilité : la colonne du milieu — la liste de la source choisie (sessions ou alertes), dense et au clavier.
import { Plus, Search } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { Notification } from '../../../commun/api-clients.ts';
import type { ResumeSession } from '../../../commun/session.ts';
import { STATUTS } from '../sessions/statut.ts';
import { useEtat } from '../shared/etat/contexte.tsx';
import { depuis, tokens } from '../shared/format.ts';
import { IconeBouton } from '../shared/ui/Bouton.tsx';
import { Point } from '../shared/ui/elements.tsx';
import { type Source, titreSource } from './navigation.ts';

function LigneSession({ s, choisie, surChoisir }: {
  readonly s: ResumeSession;
  readonly choisie: boolean;
  readonly surChoisir: () => void;
}): ReactNode {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (choisie) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [choisie]);
  return (
    <button ref={ref} type="button" onClick={surChoisir}
      className={`flex w-full cursor-default items-center gap-2.5 border-b border-filet px-3 py-[7px] text-left
        ${choisie ? 'bg-choix' : 'hover:bg-survol'}`}>
      <Point ton={STATUTS[s.statut].ton} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{s.titre}</span>
        <span className="block truncate font-mono text-[10.5px] text-discret">
          {`${s.machine} · ${s.projet.nom} · ${STATUTS[s.statut].libelle.toLowerCase()}`}
        </span>
      </span>
      <span className="shrink-0 text-right font-mono text-[10.5px] text-discret">
        {s.contexte.tokens > 0 ? tokens(s.contexte.tokens) : depuis(s.majLe)}
      </span>
    </button>
  );
}

interface PropsAlerte {
  readonly n: Notification;
  readonly surOuvrir: (id: string) => void;
}

function LigneAlerte({ n, surOuvrir }: PropsAlerte): ReactNode {
  const ton = { info: 'actif', important: 'calme', alerte: 'alerte' } as const;
  return (
    <button type="button" onClick={() => n.sessionId && surOuvrir(n.sessionId)}
      className={`flex w-full cursor-default gap-2.5 border-b border-filet px-3 py-2 text-left hover:bg-survol
        ${n.lue ? 'opacity-60' : ''}`}>
      <span className="pt-[5px]"><Point ton={ton[n.niveau]} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex justify-between gap-2">
          <span className="truncate text-[13px] font-semibold">{n.titre}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-discret">{depuis(n.ts)}</span>
        </span>
        <span className="line-clamp-2 text-[12px] text-encre-2">{n.texte}</span>
      </span>
    </button>
  );
}

interface PropsColonne {
  readonly source: Source;
  readonly sessions: readonly ResumeSession[];
  readonly choisie: string | null;
  readonly recherche: string;
  readonly surRecherche: (q: string) => void;
  readonly surChoisir: (id: string) => void;
  readonly surNouvelle: () => void;
}

export function ColonneListe(p: PropsColonne): ReactNode {
  const { source, sessions, choisie, recherche, surRecherche, surChoisir, surNouvelle } = p;
  const machines = useEtat((e) => e.machines);
  const notifications = useEtat((e) => e.notifications);
  return (
    <section className="flex h-full w-[320px] shrink-0 flex-col border-r border-filet bg-liste">
      <header className="flex h-11 items-center gap-2 border-b border-filet px-3">
        <h2 className="flex-1 truncate text-[13px] font-bold">{titreSource(source, machines)}</h2>
        <IconeBouton aide="Nouvelle session" raccourci="Ctrl+N" onClick={surNouvelle}><Plus size={15} /></IconeBouton>
      </header>
      {source.genre !== 'alertes' && (
        <label className="flex items-center gap-2 border-b border-filet px-3 py-1.5 text-discret">
          <Search size={13} />
          <input value={recherche} onChange={(e) => surRecherche(e.target.value)} placeholder="Filtrer"
            className="h-6 flex-1 bg-transparent text-[12.5px] text-encre outline-none placeholder:text-discret" />
        </label>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {source.genre === 'alertes'
          ? notifications.map((n) => <LigneAlerte key={n.seq} n={n} surOuvrir={surChoisir} />)
          : sessions.map((s) => (
            <LigneSession key={s.id} s={s} choisie={s.id === choisie} surChoisir={() => surChoisir(s.id)} />
          ))}
        {source.genre !== 'alertes' && sessions.length === 0 && (
          <p className="px-4 py-8 text-center text-[12px] text-discret">Aucune session ici.</p>
        )}
      </div>
    </section>
  );
}
