// Responsabilité : la palette de commandes (Ctrl+K) — aller à une session, une machine, une action, au clavier.
import { type KeyboardEvent, type ReactNode, useMemo, useState } from 'react';
import { useEtat } from '../shared/etat/contexte.tsx';
import type { Source } from './navigation.ts';

export interface Commande {
  readonly id: string;
  readonly libelle: string;
  readonly detail: string;
  readonly agir: () => void;
}

interface PropsPalette {
  readonly ouverte: boolean;
  readonly fermer: () => void;
  readonly allerSession: (id: string) => void;
  readonly allerSource: (s: Source) => void;
  readonly nouvelle: () => void;
}

const OMBRE = 'shadow-[0_20px_60px_-10px_rgba(0,0,0,0.45)] ring-1 ring-filet';

function useCommandes(p: PropsPalette): Commande[] {
  const sessions = useEtat((e) => e.sessions);
  const machines = useEtat((e) => e.machines);
  return useMemo(() => [
    { id: 'nouvelle', libelle: 'Nouvelle session', detail: 'Ctrl+N', agir: p.nouvelle },
    { id: 'alertes', libelle: 'Alertes', detail: 'aller à', agir: () => p.allerSource({ genre: 'alertes' }) },
    ...machines.map((m) => ({
      id: `m-${m.id}`, libelle: m.id, detail: m.enLigne ? 'machine · en ligne' : 'machine · hors ligne',
      agir: () => p.allerSource({ genre: 'machine', id: m.id }),
    })),
    ...sessions.map((s) => ({
      id: `s-${s.id}`, libelle: s.titre, detail: `${s.machine} · ${s.projet.nom}`, agir: () => p.allerSession(s.id),
    })),
  ], [sessions, machines, p]);
}

// Recherche + rang choisi, au clavier (flèches, Entrée, Échap).
function useParcours(commandes: readonly Commande[], fermer: () => void) {
  const [q, setQ] = useState('');
  const [rang, setRang] = useState(0);
  const correspond = (c: Commande): boolean => `${c.libelle} ${c.detail}`.toLowerCase().includes(q.toLowerCase());
  const filtrees = commandes.filter(correspond).slice(0, 12);
  const executer = (c: Commande | undefined): void => {
    if (!c) return;
    fermer();
    setQ('');
    c.agir();
  };
  const touche = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') fermer();
    else if (e.key === 'ArrowDown') setRang((r) => Math.min(r + 1, filtrees.length - 1));
    else if (e.key === 'ArrowUp') setRang((r) => Math.max(r - 1, 0));
    else if (e.key === 'Enter') executer(filtrees[rang]);
  };
  const chercher = (texte: string): void => {
    setQ(texte);
    setRang(0);
  };
  return { q, chercher, rang, setRang, filtrees, executer, touche };
}

export function PaletteCommandes(p: PropsPalette): ReactNode {
  const r = useParcours(useCommandes(p), p.fermer);
  if (!p.ouverte) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/20 pt-[14vh]"
      onMouseDown={(e) => e.target === e.currentTarget && p.fermer()}>
      <div className={`h-fit w-full max-w-[560px] overflow-hidden rounded-[10px] bg-fond ${OMBRE}`}>
        <input autoFocus value={r.q} onKeyDown={r.touche} onChange={(e) => r.chercher(e.target.value)}
          placeholder="Aller à une session, une machine, une action…"
          className={`h-11 w-full border-b border-filet
            bg-transparent px-4 text-[14px] outline-none placeholder:text-discret`} />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {r.filtrees.map((c, i) => (
            <button key={c.id} type="button" onMouseEnter={() => r.setRang(i)} onClick={() => r.executer(c)}
              className={`flex w-full cursor-default items-center justify-between px-4 py-1.5 text-left text-[13px]
                ${i === r.rang ? 'bg-choix' : ''}`}>
              <span className="truncate">{c.libelle}</span>
              <span className="shrink-0 pl-4 font-mono text-[10.5px] text-discret">{c.detail}</span>
            </button>
          ))}
          {r.filtrees.length === 0 && <p className="px-4 py-3 text-[12px] text-discret">Rien ne correspond.</p>}
        </div>
      </div>
    </div>
  );
}
