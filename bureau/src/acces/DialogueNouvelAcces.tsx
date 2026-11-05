// Responsabilité : créer un accès pour Claude — choisir claude.ai ou Claude Code, un nom et une durée, puis montrer
// la marche à suivre avec le jeton (une seule fois).
import { MessageSquare, SquareTerminal } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { DemandeAcces, NouvelAcces, VueAcces } from '../../../commun/api-clients.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Dialogue } from '../shared/ui/Dialogue.tsx';
import { Champ, Choix, Libelle } from '../shared/ui/elements.tsx';
import { DUREES, nomPropose } from './branchement.ts';
import { Marche } from './Marche.tsx';

export type GenreConnecteur = DemandeAcces['genre'];

const GENRES: { genre: GenreConnecteur; titre: string; detail: string; icone: ReactNode }[] = [
  { genre: 'claude-ai', titre: 'Claude.ai', detail: 'web, app de bureau, iPhone',
    icone: <MessageSquare size={15} /> },
  { genre: 'claude-code', titre: 'Claude Code', detail: 'terminal, toute machine',
    icone: <SquareTerminal size={15} /> },
];

function ChoixGenre({ genre, choisir }: {
  readonly genre: GenreConnecteur;
  readonly choisir: (g: GenreConnecteur) => void;
}): ReactNode {
  return (
    <div className="grid grid-cols-2 gap-2">
      {GENRES.map((g) => (
        <button key={g.genre} type="button" onClick={() => choisir(g.genre)}
          className={`flex cursor-default items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left ring-1
            ${genre === g.genre ? 'bg-accent-fond ring-accent' : 'ring-filet hover:bg-survol'}`}>
          <span className={genre === g.genre ? 'text-accent-texte' : 'text-discret'}>{g.icone}</span>
          <span><span className="block text-[13px] font-bold text-encre">{g.titre}</span>
            <span className="block text-[11.5px] text-discret">{g.detail}</span></span>
        </button>
      ))}
    </div>
  );
}

function Formulaire({ initial, existants, creer }: {
  readonly initial: GenreConnecteur;
  readonly existants: readonly VueAcces[];
  readonly creer: (d: DemandeAcces) => Promise<void>;
}): ReactNode {
  const [genre, setGenre] = useState<GenreConnecteur>(initial);
  const [nom, setNom] = useState(() => nomPropose(initial, existants));
  const [jours, setJours] = useState(365);
  const [envoi, setEnvoi] = useState(false);
  const choisir = (g: GenreConnecteur): void => { setGenre(g); setNom(nomPropose(g, existants)); };
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      setEnvoi(true);
      void creer({ genre, nom: nom.trim(), jours }).finally(() => setEnvoi(false));
    }}>
      <ChoixGenre genre={genre} choisir={choisir} />
      <div className="grid grid-cols-[1fr_130px] gap-3">
        <label><Libelle>Nom</Libelle><Champ value={nom} onChange={(e) => setNom(e.target.value)} maxLength={80}
          required /></label>
        <label><Libelle>Durée</Libelle><Choix value={jours} onChange={(e) => setJours(Number(e.target.value))}>
          {DUREES.map((d) => <option key={d.jours} value={d.jours}>{d.libelle}</option>)}</Choix></label>
      </div>
      <div className="flex justify-end"><Bouton ton="accent" type="submit" disabled={envoi || !nom.trim()}>
        Créer l’accès</Bouton></div>
    </form>
  );
}

export function DialogueNouvelAcces({ ouvert, initial, existants, base, creer, surFermer }: {
  readonly ouvert: boolean;
  readonly initial: GenreConnecteur;
  readonly existants: readonly VueAcces[];
  readonly base: string;
  readonly creer: (d: DemandeAcces) => Promise<NouvelAcces | null>;
  readonly surFermer: () => void;
}): ReactNode {
  const [cree, setCree] = useState<{ genre: GenreConnecteur; jeton: string } | null>(null);
  useEffect(() => { if (!ouvert) setCree(null); }, [ouvert]);
  return (
    <Dialogue ouvert={ouvert} surFermer={surFermer} largeur={600}
      titre={cree ? `Brancher ${cree.genre === 'claude-ai' ? 'Claude.ai' : 'Claude Code'}`
        : 'Nouvel accès pour Claude'}>
      {cree ? (
        <div className="flex flex-col gap-4">
          <Marche genre={cree.genre} base={base} jeton={cree.jeton} />
          <div className="flex justify-end"><Bouton onClick={surFermer}>J’ai fini</Bouton></div>
        </div>
      ) : (
        <Formulaire key={initial} initial={initial} existants={existants} creer={async (d) => {
          const n = await creer(d);
          if (n) setCree({ genre: d.genre, jeton: n.jeton });
        }} />
      )}
    </Dialogue>
  );
}
