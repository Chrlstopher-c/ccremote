// Responsabilité : les onglets de terminaux d'un appareil — des shells, et les sessions Claude attachées depuis
// l'onglet Sessions. Chaque onglet garde sa connexion tant qu'il n'est pas fermé, même caché.
import { Plus, RotateCw, SquareTerminal, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconeBouton } from '../../shared/ui/Bouton.tsx';
import type { ApiAppareil } from '../api-appareil.ts';
import { type CibleTerminal, TerminalDistant } from './TerminalDistant.tsx';

export interface OngletTerminal {
  readonly id: string;
  readonly titre: string;
  readonly cible: CibleTerminal;
  readonly generation: number;
}

export interface PropsTerminaux {
  readonly api: ApiAppareil;
  readonly onglets: readonly OngletTerminal[];
  readonly courant: string | null;
  readonly surChoisir: (id: string) => void;
  readonly surNouveau: () => void;
  readonly surFermer: (id: string) => void;
  readonly surRelancer: (id: string) => void;
}

function Barre(p: PropsTerminaux): ReactNode {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-filet px-2">
      {p.onglets.map((o) => (
        <div
          key={o.id}
          className={`group flex h-7 max-w-[220px] items-center gap-1.5 rounded-[6px] pr-1 pl-2 text-[12.5px]
          ${o.id === p.courant ? 'bg-choix font-semibold text-encre' : 'text-encre-2 hover:bg-survol'}`}
        >
          <button
            type="button"
            className="flex min-w-0 cursor-default items-center gap-1.5"
            onClick={() => p.surChoisir(o.id)}
          >
            <SquareTerminal size={13} className="shrink-0 text-discret" />
            <span className="truncate">{o.titre}</span>
          </button>
          <IconeBouton aide="Reconnecter" className="size-5" onClick={() => p.surRelancer(o.id)}>
            <RotateCw size={11} />
          </IconeBouton>
          <IconeBouton aide="Fermer" className="size-5" onClick={() => p.surFermer(o.id)}>
            <X size={12} />
          </IconeBouton>
        </div>
      ))}
      <IconeBouton aide="Nouveau terminal" onClick={p.surNouveau}>
        <Plus size={14} />
      </IconeBouton>
    </div>
  );
}

export function Terminaux(p: PropsTerminaux): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Barre {...p} />
      {p.onglets.length === 0 && (
        <div className="grid flex-1 place-items-center text-[12.5px] text-discret">
          Aucun terminal ouvert — « + » pour un shell sur {p.api.machine}.
        </div>
      )}
      {p.onglets.map((o) => (
        <TerminalDistant key={o.id} api={p.api} cible={o.cible} actif={o.id === p.courant} generation={o.generation} />
      ))}
    </div>
  );
}
