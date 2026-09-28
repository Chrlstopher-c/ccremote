// Responsabilité : la colonne des sessions du parc, regroupées par machine, filtrables (actives / toutes).
import { Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useMemo, useState } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';
import { useEtat } from '../shared/etat/contexte.tsx';
import { depuis, tokens } from '../shared/format.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Point } from '../shared/ui/elements.tsx';
import { estVivante, STATUTS } from './statut.ts';

function Ligne({ s, choisie, surChoisir }: { readonly s: ResumeSession; readonly choisie: boolean; readonly surChoisir: () => void }): ReactNode {
  const st = STATUTS[s.statut];
  return (
    <button type="button" onClick={surChoisir}
      className={`relative w-full cursor-pointer rounded-[12px] px-3 py-2.5 text-left transition-colors ${choisie ? 'bg-accent-fond' : 'hover:bg-surface-2'}`}>
      {choisie && <motion.span layoutId="session-choisie" className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent-vif" />}
      <div className="flex items-center gap-2">
        <Point ton={st.ton} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{s.titre}</span>
        {s.statut === 'question' && <span className="rounded-full bg-alerte-fond px-1.5 text-[11px] font-bold text-alerte">?</span>}
      </div>
      <div className="mt-0.5 flex justify-between pl-4 font-mono text-[11px] text-discret">
        <span className="truncate">{s.projet.nom} · {st.libelle.toLowerCase()}</span>
        <span className="shrink-0">{s.contexte.tokens > 0 ? tokens(s.contexte.tokens) : depuis(s.majLe)}</span>
      </div>
    </button>
  );
}

export function ListeSessions({ choisie, surChoisir, surNouvelle }: {
  readonly choisie: string | null; readonly surChoisir: (id: string) => void; readonly surNouvelle: () => void;
}): ReactNode {
  const sessions = useEtat((e) => e.sessions);
  const [toutes, setToutes] = useState(false);
  const groupes = useMemo(() => {
    const visibles = sessions.filter((s) => toutes || estVivante(s.statut)).toSorted((a, b) => b.majLe.localeCompare(a.majLe));
    const parMachine = new Map<string, ResumeSession[]>();
    for (const s of visibles) parMachine.set(s.machine, [...(parMachine.get(s.machine) ?? []), s]);
    return [...parMachine.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sessions, toutes]);

  return (
    <aside className="flex h-full w-[330px] shrink-0 flex-col border-r border-filet bg-surface">
      <div className="px-5 pt-6 pb-3">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-extrabold tracking-[-0.03em]">Sessions</h2>
          <Bouton compact variante="plein" icone={<Plus size={15} />} onClick={surNouvelle}>Nouvelle</Bouton>
        </div>
        <div className="flex gap-1 rounded-[10px] bg-surface-2 p-1 text-[13px] font-bold">
          {([false, true] as const).map((v) => (
            <button key={String(v)} type="button" onClick={() => setToutes(v)}
              className={`flex-1 cursor-pointer rounded-[8px] py-1.5 transition-colors ${toutes === v ? 'bg-surface text-encre ombre-carte' : 'text-discret'}`}>
              {v ? 'Toutes' : 'Ouvertes'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groupes.length === 0 && <p className="px-3 py-10 text-center text-[13px] text-discret">Aucune session ouverte.</p>}
        {groupes.map(([machine, liste]) => (
          <div key={machine} className="mb-3">
            <div className="surtitre px-3 pt-2 pb-1.5">{machine}</div>
            {liste.map((s) => <Ligne key={s.id} s={s} choisie={s.id === choisie} surChoisir={() => surChoisir(s.id)} />)}
          </div>
        ))}
      </div>
    </aside>
  );
}
