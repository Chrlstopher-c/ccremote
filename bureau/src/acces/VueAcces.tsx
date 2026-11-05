// Responsabilité : l'écran « Accès » — qui peut parler au relais (appareils connectés, connecteurs Claude), brancher
// claude.ai ou Claude Code sur Quart, révoquer un accès.
import { MessageSquare, Monitor, Plus, RefreshCw, SquareTerminal, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { GenreAcces, VueAcces as Acces } from '../../../commun/api-clients.ts';
import { dans, depuis } from '../shared/format.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { LIBELLES_GENRE, nomLisible, regrouperAcces } from './branchement.ts';
import { DialogueNouvelAcces, type GenreConnecteur } from './DialogueNouvelAcces.tsx';
import { useAcces } from './useAcces.ts';

const ICONES: Record<GenreAcces, ReactNode> = {
  appareil: <Monitor size={14} />,
  'claude-ai': <MessageSquare size={14} />,
  'claude-code': <SquareTerminal size={14} />,
};

function LigneAcces({ a, revoquer }: { readonly a: Acces; readonly revoquer: (id: string) => void }): ReactNode {
  const [confirmer, setConfirmer] = useState(false);
  return (
    <div className="group flex h-10 items-center gap-3 rounded-[6px] px-2 text-[12.5px] hover:bg-survol"
      onMouseLeave={() => setConfirmer(false)}>
      <span className="text-discret">{ICONES[a.genre]}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-encre" title={a.nom}>{nomLisible(a.nom)}</span>
      {a.courant && <span className="rounded-full bg-accent-fond px-2 py-px text-[11px] font-semibold
        text-accent-texte">cet appareil</span>}
      <span className="w-36 text-[11.5px] text-discret">{a.vuLe ? `vu ${depuis(a.vuLe)}` : 'jamais utilisé'}</span>
      <span className="w-28 text-[11.5px] text-discret">{`créé ${depuis(a.creeLe)}`}</span>
      <span className="w-32 text-[11.5px] text-discret">{`expire ${dans(a.expireLe)}`}</span>
      {confirmer ? (
        <Bouton ton="danger" onClick={() => revoquer(a.id)}>
          {a.courant ? 'Révoquer et me déconnecter' : 'Révoquer'}
        </Bouton>
      ) : (
        <button type="button" onClick={() => setConfirmer(true)} aria-label={`Révoquer ${a.nom}`} title="Révoquer"
          className="grid size-7 cursor-default place-items-center rounded-[6px] text-danger opacity-0
            hover:bg-survol group-hover:opacity-100"><Trash2 size={13} /></button>
      )}
    </div>
  );
}

function Brancher({ ouvrir }: { readonly ouvrir: (g: GenreConnecteur) => void }): ReactNode {
  const carte = (g: GenreConnecteur, titre: string, texte: string, icone: ReactNode): ReactNode => (
    <div className="flex flex-col gap-2 rounded-[10px] p-4 ring-1 ring-filet">
      <div className="flex items-center gap-2 text-[13.5px] font-bold text-encre">
        <span className="text-accent-texte">{icone}</span>{titre}</div>
      <p className="flex-1 text-[12px] leading-relaxed text-discret">{texte}</p>
      <div><Bouton icone={<Plus size={13} />} onClick={() => ouvrir(g)}>Créer l’accès</Bouton></div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 border-b border-filet px-5 py-4">
      {carte('claude-ai', 'Claude.ai', 'Un connecteur personnalisé : depuis le web, l’app de bureau ou l’iPhone, '
        + 'Claude voit le parc et ouvre des sessions sur tes machines.', <MessageSquare size={15} />)}
      {carte('claude-code', 'Claude Code', 'Une commande à coller dans le terminal de n’importe quelle machine : '
        + 'les outils quart_* y deviennent disponibles, sans rien installer.', <SquareTerminal size={15} />)}
    </div>
  );
}

export function VueAcces(): ReactNode {
  const a = useAcces();
  const [dialogue, setDialogue] = useState<GenreConnecteur | null>(null);
  const groupes = regrouperAcces(a.liste ?? []);
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-fond">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-filet px-5">
        <h1 className="flex-1 text-[13.5px] font-bold">Accès</h1>
        <Bouton icone={<RefreshCw size={13} />} onClick={() => void a.recharger()}>Actualiser</Bouton>
        <Bouton ton="accent" icone={<Plus size={13} />} onClick={() => setDialogue('claude-ai')}>Nouvel accès</Bouton>
      </header>
      {a.erreur && <button type="button" onClick={a.effacer} className="cursor-default border-b border-filet px-5
        py-1.5 text-left text-[12px] text-danger">{a.erreur}</button>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Brancher ouvrir={setDialogue} />
        {groupes.map((g) => (
          <section key={g.genre} className="border-b border-filet px-5 py-3">
            <div className="etiquette px-2 pb-1">{`${LIBELLES_GENRE[g.genre]} · ${g.acces.length}`}</div>
            {g.acces.map((x) => <LigneAcces key={x.id} a={x} revoquer={(id) => void a.revoquer(id)} />)}
          </section>
        ))}
        {a.liste === null && !a.erreur && <p className="p-6 text-[12.5px] text-discret">Chargement…</p>}
      </div>
      <DialogueNouvelAcces ouvert={dialogue !== null} initial={dialogue ?? 'claude-ai'} existants={a.liste ?? []}
        base={a.base} creer={a.creer} surFermer={() => setDialogue(null)} />
    </section>
  );
}
