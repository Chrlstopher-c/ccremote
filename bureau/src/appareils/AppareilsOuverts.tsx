// Responsabilité : les appareils ouverts dans l'app. Un appareil visité reste monté (caché) : ses terminaux et son
// explorateur survivent à un détour par les sessions. Le code (xterm, éditeur) ne se charge qu'à la première visite.
import { lazy, type ReactNode, Suspense, useState } from 'react';
import type { Source } from '../app/navigation.ts';
import { useEtat } from '../shared/etat/contexte.tsx';

const VueAppareil = lazy(() => import('./VueAppareil.tsx'));

export function AppareilsOuverts({ source, surFil, surNouvelle }: {
  readonly source: Source;
  readonly surFil: (sessionId: string) => void;
  readonly surNouvelle: (machine: string) => void;
}): ReactNode {
  const machines = useEtat((e) => e.machines);
  const [visites, setVisites] = useState<string[]>([]);
  if (source.genre === 'appareil' && !visites.includes(source.id)) setVisites((v) => [...v, source.id]);
  const ouverts = visites.map((id) => machines.find((m) => m.id === id)).filter((m) => m !== undefined);
  return ouverts.map((m) => (
    <div key={m.id} className={source.genre === 'appareil' && source.id === m.id ? 'flex min-w-0 flex-1' : 'hidden'}>
      <Suspense fallback={<p className="p-5 text-[12.5px] text-discret">Chargement…</p>}>
        <VueAppareil m={m} surFil={surFil} surNouvelle={surNouvelle} />
      </Suspense>
    </div>
  ));
}
