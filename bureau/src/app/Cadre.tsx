// Responsabilité : le cadre à trois panneaux — sources, liste, détail — et ce qui les relie (sélection, clavier,
// palette).
import { MessagesSquare } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { NouvelleSession } from '../sessions/NouvelleSession.tsx';
import { VueSession } from '../sessions/VueSession.tsx';
import type { ResumeSession } from '../../../commun/session.ts';
import { useEtat } from '../shared/etat/contexte.tsx';
import { ouvrirTerminal } from '../shared/natif.ts';
import { Touche } from '../shared/ui/elements.tsx';
import { VueMachine } from '../parc/VueMachine.tsx';
import { AppareilsOuverts } from '../appareils/AppareilsOuverts.tsx';
import { BarreLaterale } from './BarreLaterale.tsx';
import { ColonneListe } from './ColonneListe.tsx';
import { SOURCE_DEFAUT, sessionsDe, type Source } from './navigation.ts';
import { VueComptes } from '../comptes/VueComptes.tsx';
import { VueEcho } from '../echo/VueEcho.tsx';
import { PaletteCommandes } from './PaletteCommandes.tsx';
import { useRaccourcis } from './useRaccourcis.ts';

function Vide(): ReactNode {
  return (
    <section className="grid flex-1 place-items-center bg-fond text-center text-[12.5px] text-discret">
      <div>
        <MessagesSquare size={22} className="mx-auto mb-2 opacity-60" />
        <p>Aucune session choisie.</p>
        <p className="mt-2 flex items-center justify-center gap-1.5">
          <Touche>Ctrl K</Touche> aller à · <Touche>Ctrl N</Touche> nouvelle
        </p>
      </div>
    </section>
  );
}

function useSelection() {
  const [source, setSource] = useState<Source>(SOURCE_DEFAUT);
  const [choisie, setChoisie] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const toutes = useEtat((e) => e.sessions);
  const liste = useMemo(() => sessionsDe(source, toutes, recherche), [source, toutes, recherche]);
  const decaler = (pas: number): void => {
    const i = liste.findIndex((s) => s.id === choisie);
    const suivante = liste[Math.max(0, Math.min(liste.length - 1, i + pas))];
    if (suivante) setChoisie(suivante.id);
  };
  const choisirSource = (s: Source): void => {
    setSource(s);
    setChoisie(null);
  };
  return { source, choisirSource, choisie, setChoisie, recherche, setRecherche, liste, toutes, decaler };
}

export function Cadre({ surDeconnexion }: { readonly surDeconnexion: () => void }): ReactNode {
  const sel = useSelection();
  const [palette, setPalette] = useState(false);
  const [nouvelle, setNouvelle] = useState<boolean | string>(false); // une machine : ouverte depuis un appareil
  const machines = useEtat((e) => e.machines);
  const session = sel.toutes.find((s) => s.id === sel.choisie) ?? null;
  const src = sel.source;
  const machine = src.genre === 'machine' ? machines.find((m) => m.id === src.id) : undefined;
  const allerSession = (id: string): void => {
    sel.choisirSource({ genre: 'sessions', filtre: 'toutes' });
    sel.setChoisie(id);
  };
  useRaccourcisCadre(sel, session, machines.find((m) => m.id === session?.machine)?.etat?.utilisateur,
    setPalette, setNouvelle);
  return (
    <div className="flex h-full">
      <BarreLaterale source={sel.source} surChoisir={sel.choisirSource} surDeconnexion={surDeconnexion} />
      <AppareilsOuverts source={src} surFil={allerSession} surNouvelle={setNouvelle} />
      {src.genre === 'appareil' ? null : src.genre === 'echo' ? <VueEcho /> : src.genre === 'comptes' ? <VueComptes /> : (
        <>
          <ColonneListe source={sel.source} sessions={sel.liste} choisie={sel.choisie} recherche={sel.recherche}
            surRecherche={sel.setRecherche} surChoisir={allerOuChoisir(sel, allerSession)}
            surNouvelle={() => setNouvelle(true)} />
          {session ? <VueSession key={session.id} session={session} />
            : machine ? <VueMachine m={machine} /> : <Vide />}
        </>
      )}
      <PaletteCommandes ouverte={palette} fermer={() => setPalette(false)} allerSession={allerSession}
        allerSource={sel.choisirSource} nouvelle={() => setNouvelle(true)} />
      <NouvelleSession ouvert={nouvelle !== false} machine={typeof nouvelle === 'string' ? nouvelle : undefined}
        surFermer={() => setNouvelle(false)} surOuverte={(id) => { setNouvelle(false); allerSession(id); }} />
    </div>
  );
}

function useRaccourcisCadre(
  sel: Selection,
  session: ResumeSession | null,
  utilisateur: string | undefined,
  setPalette: (v: boolean) => void,
  setNouvelle: (v: boolean) => void,
): void {
  const raccourcis = useMemo(() => ({
    palette: () => setPalette(true), nouvelle: () => setNouvelle(true),
    suivante: () => sel.decaler(1), precedente: () => sel.decaler(-1),
    terminal: () => { if (session?.tmux) void ouvrirTerminal(session.machine, session.tmux, utilisateur); },
    ecrire: () => window.dispatchEvent(new Event('ccremote:ecrire')),
  }), [sel, session, utilisateur, setPalette, setNouvelle]);
  useRaccourcis(raccourcis);
}

// Depuis les alertes, choisir mène à la session concernée ; ailleurs, la sélection reste dans la liste courante.
type Selection = ReturnType<typeof useSelection>;

function allerOuChoisir(sel: Selection, allerSession: (id: string) => void): (id: string) => void {
  return sel.source.genre === 'alertes' ? allerSession : sel.setChoisie;
}
