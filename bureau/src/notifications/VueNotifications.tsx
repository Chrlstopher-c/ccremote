// Responsabilité : ce qui mérite l'attention de Chris — objectifs atteints, questions, erreurs, étapes.
import { CheckCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Notification } from '../../../commun/api-clients.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';
import { depuis } from '../shared/format.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';

const TONS: Record<Notification['niveau'], string> = {
  info: 'bg-accent-vif',
  important: 'bg-succes',
  alerte: 'bg-danger',
};

interface PropsCarte {
  readonly n: Notification;
  readonly surOuvrir: (id: string) => void;
}

function CarteNotification({ n, surOuvrir }: PropsCarte): ReactNode {
  return (
    <button
      type="button"
      onClick={() => n.sessionId && surOuvrir(n.sessionId)}
      className={`flex w-full cursor-pointer gap-4 rounded-[16px] bg-surface px-5 py-4 text-left ombre-carte
        transition-opacity ${n.lue ? 'opacity-60' : ''}`}
    >
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONS[n.niveau]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex justify-between gap-3">
          <span className="truncate text-[14.5px] font-bold">{n.titre}</span>
          <span className="shrink-0 font-mono text-[11px] text-discret">{depuis(n.ts)}</span>
        </span>
        <span className="mt-1 line-clamp-3 block text-[13.5px] leading-relaxed text-encre-douce">{n.texte}</span>
      </span>
    </button>
  );
}

export function VueNotifications({ surOuvrirSession }: { readonly surOuvrirSession: (id: string) => void }): ReactNode {
  const { client } = useMagasin();
  const notifications = useEtat((e) => e.notifications);
  const derniere = notifications[0]?.seq ?? 0;
  return (
    <section className="h-full flex-1 overflow-y-auto bg-fond px-10 py-8">
      <div className="mx-auto max-w-[760px]">
        <div className="surtitre mb-2">Fil d’alerte</div>
        <div className="mb-6 flex items-end justify-between">
          <h1 className="text-[30px] font-extrabold tracking-[-0.04em]">Notifications</h1>
          <Bouton
            compact
            variante="discret"
            icone={<CheckCheck size={15} />}
            disabled={derniere === 0}
            onClick={() => void client.marquerLues(derniere)}
          >
            Tout marquer lu
          </Bouton>
        </div>
        {notifications.length === 0 && <p className="py-16 text-center text-[14px] text-discret">Rien à signaler.</p>}
        <div className="space-y-2">
          {notifications.map((n) => <CarteNotification key={n.seq} n={n} surOuvrir={surOuvrirSession} />)}
        </div>
      </div>
    </section>
  );
}
