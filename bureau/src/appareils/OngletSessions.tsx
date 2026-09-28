// Responsabilité : les sessions Claude d'un appareil — les voir, en lancer une, s'y attacher dans un terminal de
// l'app (partout, 4G comprise) ou dans kitty (app de bureau), ouvrir leur fil.
import { ExternalLink, MessagesSquare, Plus, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';
import { useEtat } from '../shared/etat/contexte.tsx';
import { depuis } from '../shared/format.ts';
import { estBureau, ouvrirTerminal } from '../shared/natif.ts';
import { Bouton, IconeBouton } from '../shared/ui/Bouton.tsx';
import { Point } from '../shared/ui/elements.tsx';
import { STATUTS } from '../sessions/statut.ts';

export interface PropsOngletSessions {
  readonly machine: string;
  readonly utilisateur?: string;
  readonly surTerminal: (s: ResumeSession) => void;
  readonly surFil: (id: string) => void;
  readonly surNouvelle: () => void;
}

function Ligne({ s, p }: { readonly s: ResumeSession; readonly p: PropsOngletSessions }): ReactNode {
  const statut = STATUTS[s.statut];
  return (
    <div className="flex h-11 items-center gap-3 border-b border-filet px-4 text-[13px]">
      <Point ton={statut.ton} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{s.titre}</div>
        <div className="truncate font-mono text-[11px] text-discret">
          {s.projet.nom} · {statut.libelle} · {depuis(s.majLe)}
        </div>
      </div>
      <IconeBouton aide="Voir le fil" onClick={() => p.surFil(s.id)}>
        <MessagesSquare size={14} />
      </IconeBouton>
      {s.tmux && (
        <IconeBouton aide="Terminal dans l’app" onClick={() => p.surTerminal(s)}>
          <SquareTerminal size={14} />
        </IconeBouton>
      )}
      {s.tmux && estBureau() && (
        <IconeBouton
          aide="Ouvrir dans kitty"
          onClick={() => void ouvrirTerminal(s.machine, s.tmux ?? '', p.utilisateur)}
        >
          <ExternalLink size={14} />
        </IconeBouton>
      )}
    </div>
  );
}

export function OngletSessions(p: PropsOngletSessions): ReactNode {
  const sessions = useEtat((e) => e.sessions)
    .filter((s) => s.machine === p.machine && s.statut !== 'fermee')
    .toSorted((a, b) => b.majLe.localeCompare(a.majLe));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-filet px-4">
        <span className="etiquette flex-1">{`sessions ouvertes · ${sessions.length}`}</span>
        <Bouton ton="accent" icone={<Plus size={13} />} onClick={p.surNouvelle}>
          Nouvelle session ici
        </Bouton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <Ligne key={s.id} s={s} p={p} />
        ))}
        {sessions.length === 0 && (
          <p className="p-4 text-[12.5px] text-discret">Aucune session ouverte sur {p.machine}.</p>
        )}
      </div>
    </div>
  );
}
