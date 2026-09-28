// Responsabilité : l'accès complet à un appareil du parc — ses fichiers, ses terminaux, ses sessions Claude — dans
// l'app, depuis n'importe quel réseau : tout passe par le relais, rien par SSH côté client.
import { FolderOpen, MessagesSquare, SquareTerminal } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import type { VueMachine } from '../../../commun/api-clients.ts';
import type { ResumeSession } from '../../../commun/session.ts';
import { useMagasin } from '../shared/etat/contexte.tsx';
import { Point } from '../shared/ui/elements.tsx';
import { ApiAppareil } from './api-appareil.ts';
import { ExplorateurFichiers } from './fichiers/Explorateur.tsx';
import { OngletSessions } from './OngletSessions.tsx';
import { type OngletTerminal, Terminaux } from './terminal/Terminaux.tsx';

export type Onglet = 'fichiers' | 'terminal' | 'sessions';

const ONGLETS: readonly { readonly id: Onglet; readonly libelle: string; readonly icone: ReactNode }[] = [
  { id: 'fichiers', libelle: 'Fichiers', icone: <FolderOpen size={14} /> },
  { id: 'terminal', libelle: 'Terminal', icone: <SquareTerminal size={14} /> },
  { id: 'sessions', libelle: 'Sessions', icone: <MessagesSquare size={14} /> },
];

function useTerminaux() {
  const [onglets, setOnglets] = useState<OngletTerminal[]>([]);
  const [courant, setCourant] = useState<string | null>(null);
  const ajouter = (titre: string, cible: OngletTerminal['cible']): void => {
    const id = crypto.randomUUID();
    setOnglets((o) => [...o, { id, titre, cible, generation: 0 }]);
    setCourant(id);
  };
  return {
    onglets,
    courant,
    surChoisir: setCourant,
    shell: () => ajouter('shell', {}),
    attacher: (s: ResumeSession) => {
      const deja = onglets.find((o) => o.cible.tmux === s.tmux);
      if (deja) return setCourant(deja.id);
      ajouter(s.titre, { tmux: s.tmux ?? undefined });
    },
    surFermer: (id: string) => {
      const reste = onglets.filter((o) => o.id !== id);
      setOnglets(reste);
      if (courant === id) setCourant(reste.at(-1)?.id ?? null);
    },
    surRelancer: (id: string) =>
      setOnglets((o) => o.map((t) => (t.id === id ? { ...t, generation: t.generation + 1 } : t))),
  };
}

type Terminaux_ = ReturnType<typeof useTerminaux>;

function Entete({ m, onglet, choisir }: {
  readonly m: VueMachine;
  readonly onglet: Onglet;
  readonly choisir: (o: Onglet) => void;
}): ReactNode {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-filet px-4">
      <Point ton={m.enLigne ? 'calme' : 'eteint'} />
      <h1 className="text-[13.5px] font-bold">{m.id}</h1>
      <span className="min-w-0 flex-1 truncate text-[12px] text-discret">{m.description}</span>
      <nav className="flex gap-1">
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" onClick={() => choisir(o.id)}
            className={`flex h-7 cursor-default items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px]
              ${onglet === o.id ? 'bg-choix font-semibold text-encre' : 'text-encre-2 hover:bg-survol'}`}>
            {o.icone}
            {o.libelle}
          </button>
        ))}
      </nav>
    </header>
  );
}

const visible = (oui: boolean): string => (oui ? 'flex min-h-0 flex-1' : 'hidden');

function Corps({ m, api, onglet, t, montrer, surFil, surNouvelle }: {
  readonly m: VueMachine;
  readonly api: ApiAppareil;
  readonly onglet: Onglet;
  readonly t: Terminaux_;
  readonly montrer: (o: Onglet) => void; // sans ouvrir de shell : l'onglet de la session vient d'être ajouté
  readonly surFil: (id: string) => void;
  readonly surNouvelle: (machine: string) => void;
}): ReactNode {
  return (
    <>
      <div className={visible(onglet === 'fichiers')}>
        <ExplorateurFichiers api={api} />
      </div>
      <div className={visible(onglet === 'terminal')}>
        <Terminaux api={api} onglets={t.onglets} courant={t.courant} surChoisir={t.surChoisir} surNouveau={t.shell}
          surFermer={t.surFermer} surRelancer={t.surRelancer} />
      </div>
      <div className={visible(onglet === 'sessions')}>
        <OngletSessions machine={m.id} utilisateur={m.etat?.utilisateur} surFil={surFil}
          surNouvelle={() => surNouvelle(m.id)} surTerminal={(s) => { t.attacher(s); montrer('terminal'); }} />
      </div>
    </>
  );
}

export default function VueAppareil({ m, surFil, surNouvelle }: {
  readonly m: VueMachine;
  readonly surFil: (id: string) => void;
  readonly surNouvelle: (machine: string) => void;
}): ReactNode {
  const { client } = useMagasin();
  const api = useMemo(() => new ApiAppareil(client, m.id), [client, m.id]);
  const [onglet, setOnglet] = useState<Onglet>('fichiers');
  const t = useTerminaux();
  const choisir = (o: Onglet): void => {
    setOnglet(o);
    if (o === 'terminal' && t.onglets.length === 0 && m.enLigne) t.shell();
  };
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-fond">
      <Entete m={m} onglet={onglet} choisir={choisir} />
      {m.enLigne ? (
        <Corps m={m} api={api} onglet={onglet} t={t} montrer={setOnglet} surFil={surFil} surNouvelle={surNouvelle} />
      ) : (
        <p className="p-5 text-[13px] text-discret">{m.id} est hors ligne — réveille-la depuis la section Machines.</p>
      )}
    </section>
  );
}
