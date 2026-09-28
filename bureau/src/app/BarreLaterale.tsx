// Responsabilité : la barre latérale — sources (sessions, machines, alertes), état du lien, déconnexion.
import { Bell, Circle, Layers, LogOut, MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEtat } from '../shared/etat/contexte.tsx';
import { Point } from '../shared/ui/elements.tsx';
import { memeSource, nonLues, type Source } from './navigation.ts';
import { estOuverte } from '../sessions/statut.ts';

interface PropsEntree {
  readonly source: Source;
  readonly courante: Source;
  readonly surChoisir: (s: Source) => void;
  readonly icone: ReactNode;
  readonly libelle: string;
  readonly compteur?: number;
}

function Entree({ source, courante, surChoisir, icone, libelle, compteur }: PropsEntree): ReactNode {
  const choisie = memeSource(source, courante);
  return (
    <button type="button" onClick={() => surChoisir(source)}
      className={`flex h-7 w-full cursor-default items-center gap-2 rounded-[6px] px-2 text-[13px]
        ${choisie ? 'bg-choix font-semibold text-encre' : 'text-encre-2 hover:bg-survol'}`}>
      <span className="flex w-4 justify-center text-discret">{icone}</span>
      <span className="flex-1 truncate text-left">{libelle}</span>
      {compteur !== undefined && compteur > 0 && <span className="font-mono text-[11px] text-discret">{compteur}</span>}
    </button>
  );
}

function Section({ titre, children }: { readonly titre: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="mb-4">
      <div className="etiquette px-2 pb-1">{titre}</div>
      {children}
    </div>
  );
}

interface PropsMachines {
  readonly courante: Source;
  readonly surChoisir: (s: Source) => void;
}

function Machines({ courante, surChoisir }: PropsMachines): ReactNode {
  const machines = useEtat((e) => e.machines);
  const sessions = useEtat((e) => e.sessions);
  return (
    <Section titre="Machines">
      {machines.map((m) => (
        <Entree key={m.id} source={{ genre: 'machine', id: m.id }} courante={courante} surChoisir={surChoisir}
          icone={<Point ton={m.enLigne ? 'calme' : 'eteint'} />} libelle={m.id}
          compteur={sessions.filter((s) => s.machine === m.id && estOuverte(s)).length} />
      ))}
    </Section>
  );
}

function Pied({ surDeconnexion }: { readonly surDeconnexion: () => void }): ReactNode {
  const lien = useEtat((e) => e.lien);
  const pastille = lien === 'ouvert' ? 'fill-succes text-succes' : 'animate-pulse fill-alerte text-alerte';
  return (
    <div className="flex items-center justify-between border-t border-filet px-3 py-2 text-[11.5px] text-discret">
      <span className="flex items-center gap-1.5">
        <Circle size={7} className={pastille} />
        {lien === 'ouvert' ? 'relais connecté' : 'reconnexion…'}
      </span>
      <button type="button" onClick={surDeconnexion} title="Se déconnecter" aria-label="Se déconnecter"
        className="cursor-default rounded-[5px] p-1 hover:bg-survol hover:text-encre"><LogOut size={13} /></button>
    </div>
  );
}

export function BarreLaterale({ source, surChoisir, surDeconnexion }: {
  readonly source: Source;
  readonly surChoisir: (s: Source) => void;
  readonly surDeconnexion: () => void;
}): ReactNode {
  const sessions = useEtat((e) => e.sessions);
  const alertes = useEtat((e) => nonLues(e.notifications));
  const ouvertes = sessions.filter((s) => estOuverte(s)).length;
  return (
    <nav className="flex h-full w-[210px] shrink-0 flex-col border-r border-filet bg-cote">
      <div className="px-4 pt-3.5 pb-3 text-[14px] font-extrabold tracking-[-0.03em]">ccremote</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <Section titre="Sessions">
          <Entree source={{ genre: 'sessions', filtre: 'ouvertes' }} courante={source} surChoisir={surChoisir}
            icone={<MessagesSquare size={14} />} libelle="Ouvertes" compteur={ouvertes} />
          <Entree source={{ genre: 'sessions', filtre: 'toutes' }} courante={source} surChoisir={surChoisir}
            icone={<Layers size={14} />} libelle="Toutes" compteur={sessions.length} />
          <Entree source={{ genre: 'alertes' }} courante={source} surChoisir={surChoisir}
            icone={<Bell size={14} />} libelle="Alertes" compteur={alertes} />
        </Section>
        <Machines courante={source} surChoisir={surChoisir} />
      </div>
      <Pied surDeconnexion={surDeconnexion} />
    </nav>
  );
}
