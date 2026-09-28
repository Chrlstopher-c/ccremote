// Responsabilité : la barre latérale night — marque, navigation, état du lien et des machines.
import { Bell, LogOut, MessagesSquare, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEtat } from '../shared/etat/contexte.tsx';

export type Vue = 'sessions' | 'parc' | 'notifications';

function Lien({
  actif,
  icone,
  libelle,
  compteur,
  surClic,
}: {
  readonly actif: boolean;
  readonly icone: ReactNode;
  readonly libelle: string;
  readonly compteur?: number;
  readonly surClic: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={surClic}
      className={`relative flex h-10 w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 text-[14px]
        font-bold transition-colors
        ${actif ? 'bg-night-actif text-night-text' : 'text-night-soft hover:bg-night-3 hover:text-night-text'}`}
    >
      {actif && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-brand-400" />}
      {icone}
      <span className="flex-1 text-left">{libelle}</span>
      {compteur !== undefined && compteur > 0 && (
        <span className="rounded-full bg-white px-2 text-[11px] font-extrabold text-night">{compteur}</span>
      )}
    </button>
  );
}

function Machines(): ReactNode {
  const machines = useEtat((e) => e.machines);
  return (
    <>
      <div className="mt-8 px-3 font-mono text-[10.5px] tracking-[0.14em] text-night-muted uppercase">Machines</div>
      <ul className="mt-2 space-y-1 px-3">
        {machines.map((m) => (
          <li key={m.id} className="flex items-center gap-2.5 text-[13px] text-night-soft">
            <span className={`size-1.5 rounded-full ${m.enLigne ? 'bg-brand-400' : 'bg-night-4'}`} />
            {m.id}
          </li>
        ))}
      </ul>
    </>
  );
}

function Pied({ surDeconnexion }: { readonly surDeconnexion: () => void }): ReactNode {
  const lien = useEtat((e) => e.lien);
  return (
    <>
      <div className="flex items-center justify-between px-3 text-[12px] text-night-muted">
        <span className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${lien === 'ouvert' ? 'bg-brand-light' : 'animate-pulse bg-night-4'}`}
          />
          {lien === 'ouvert' ? 'relais connecté' : 'reconnexion…'}
        </span>
        <button
          type="button"
          onClick={surDeconnexion}
          aria-label="Se déconnecter"
          className="cursor-pointer rounded-[8px] p-1.5 hover:bg-night-3 hover:text-night-text"
        >
          <LogOut size={15} />
        </button>
      </div>
      <img src="/wordmark.svg" alt="Echo Agency" className="mx-3 mt-5 h-7 w-fit opacity-45 invert" />
    </>
  );
}

function Navigation({ vue, surVue }: { readonly vue: Vue; readonly surVue: (v: Vue) => void }): ReactNode {
  const ouvertes = useEtat((e) => e.sessions.filter((s) => s.tmux !== null).length);
  const nonLues = useEtat((e) => e.notifications.filter((n) => !n.lue && n.niveau !== 'info').length);
  const liens: [Vue, string, ReactNode, number | undefined][] = [
    ['sessions', 'Sessions', <MessagesSquare key="s" size={17} />, ouvertes],
    ['parc', 'Parc', <Server key="p" size={17} />, undefined],
    ['notifications', 'Notifications', <Bell key="n" size={17} />, nonLues],
  ];
  return (
    <div className="space-y-1">
      {liens.map(([id, libelle, icone, compteur]) => (
        <Lien key={id} actif={vue === id} icone={icone} libelle={libelle} compteur={compteur}
          surClic={() => surVue(id)} />
      ))}
    </div>
  );
}

export function BarreLaterale({
  vue,
  surVue,
  surDeconnexion,
}: {
  readonly vue: Vue;
  readonly surVue: (v: Vue) => void;
  readonly surDeconnexion: () => void;
}): ReactNode {
  return (
    <nav className="flex h-full w-[232px] shrink-0 flex-col bg-night px-3 py-5 text-night-text">
      <div className="mb-7 px-3">
        <div className="text-[21px] font-extrabold tracking-[-0.045em]">ccremote</div>
        <div className="font-mono text-[10.5px] tracking-[0.14em] text-night-muted uppercase">sessions claude</div>
      </div>
      <Navigation vue={vue} surVue={surVue} />
      <Machines />
      <span className="flex-1" />
      <Pied surDeconnexion={surDeconnexion} />
    </nav>
  );
}
