// Responsabilité : à la place du compositeur, dire pourquoi on ne peut pas écrire à cette session (et quoi faire).
import { Sunrise, SquareTerminal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';
import { Bouton } from '../shared/ui/Bouton.tsx';

/** La raison de lecture seule, ou null si la session accepte des messages. */
export function useLectureSeule(s: ResumeSession): 'terminal' | 'hors_ligne' | null {
  const enLigne = useEtat((e) => e.machines.find((m) => m.id === s.machine)?.enLigne ?? false);
  if (!enLigne) return 'hors_ligne';
  return s.terminal ? 'terminal' : null;
}

type Raison = 'terminal' | 'hors_ligne';

export function LectureSeule({ s, raison }: { readonly s: ResumeSession; readonly raison: Raison }): ReactNode {
  const { client } = useMagasin();
  const peutReveiller = useEtat((e) => e.reveilPossible.includes(s.machine));
  const [etat, setEtat] = useState<string | null>(null);
  const reveiller = (): void => {
    setEtat('Réveil envoyé…');
    client.reveiller(s.machine).catch((e: unknown) => setEtat(String(e)));
  };
  return (
    <div className={`flex shrink-0 items-center gap-3 border-t
      border-filet bg-liste px-4 py-2.5 text-[12.5px] text-encre-2`}>
      {raison === 'terminal'
        ? <SquareTerminal size={14} className="text-discret" />
        : <Sunrise size={14} className="text-discret" />}
      <span className="flex-1">
        {raison === 'terminal'
          ? 'Ouverte dans un terminal, hors tmux : lisible ici, pilotable seulement depuis ce terminal.'
          : etat ?? `${s.machine} est hors ligne : réveille-la pour reprendre cette session.`}
      </span>
      {raison === 'hors_ligne' && peutReveiller && <Bouton onClick={reveiller}>Réveiller</Bouton>}
    </div>
  );
}
