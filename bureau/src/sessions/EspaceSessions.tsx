// Responsabilité : l'espace de travail des sessions — liste, session choisie, ouverture d'une nouvelle.
import { MessagesSquare } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useEtat } from '../shared/etat/contexte.tsx';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { ListeSessions } from './ListeSessions.tsx';
import { NouvelleSession } from './NouvelleSession.tsx';
import { VueSession } from './VueSession.tsx';

function Accueil({ surNouvelle }: { readonly surNouvelle: () => void }): ReactNode {
  return (
    <section className="grid flex-1 place-items-center bg-fond">
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-[18px] bg-accent-fond text-accent-texte">
          <MessagesSquare size={24} />
        </div>
        <h2 className="text-[20px] font-extrabold tracking-[-0.03em]">Aucune session choisie</h2>
        <p className="mt-1 mb-5 text-[14px] text-discret">
          Choisis-en une à gauche, ou lances-en une sur n’importe quelle machine.
        </p>
        <Bouton variante="plein" onClick={surNouvelle}>Nouvelle session</Bouton>
      </div>
    </section>
  );
}

interface PropsEspace {
  readonly choisie: string | null;
  readonly surChoisir: (id: string) => void;
}

export function EspaceSessions({ choisie, surChoisir }: PropsEspace): ReactNode {
  const session = useEtat((e) => e.sessions.find((s) => s.id === choisie) ?? null);
  const [nouvelle, setNouvelle] = useState(false);
  const ouverte = (id: string): void => {
    setNouvelle(false);
    surChoisir(id);
  };
  return (
    <>
      <ListeSessions choisie={choisie} surChoisir={surChoisir} surNouvelle={() => setNouvelle(true)} />
      {session ? <VueSession key={session.id} session={session} /> : <Accueil surNouvelle={() => setNouvelle(true)} />}
      <NouvelleSession ouvert={nouvelle} surFermer={() => setNouvelle(false)} surOuverte={ouverte} />
    </>
  );
}
