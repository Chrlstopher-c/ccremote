// Responsabilité : afficher le fil d'une session dans l'écran d'agent — bulles de Chris, réponses de Claude en
// Markdown, réflexions repliées, suites d'outils regroupées (dépliables : entrée et résultat), cartes de sous-agents,
// repères (étapes, compaction, fin de tour), texte en cours d'écriture ; défilement collé en bas.
import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { EvenementDate } from '../../donnees';
import { resumeOutils, structurerFil, type Bloc, type OutilVu } from './fil-structure';

const heure = (ts: string): string => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function Texte(p: { texte: string }) {
  return (
    <div className="fil-md">
      <Markdown remarkPlugins={[remarkGfm]}>{p.texte}</Markdown>
    </div>
  );
}

function LigneOutil(p: { o: OutilVu }) {
  const [ouvert, setOuvert] = useState(false);
  const r = p.o.resultat;
  const etat = !r ? 'cours' : r.erreur ? 'erreur' : 'ok';
  return (
    <div className={`outil ${etat}`}>
      <button className="outil-ligne" onClick={() => setOuvert(!ouvert)}>
        <span className="outil-nom">{p.o.appel.nom}</span>
        <span className="outil-cible">{p.o.appel.resume}</span>
        <span className="outil-etat">{etat === 'cours' ? '…' : etat === 'erreur' ? '✕' : '✓'}</span>
      </button>
      {ouvert ? (
        <div className="outil-detail">
          <pre>{p.o.appel.detail}</pre>
          {r ? <pre className="outil-resultat">{r.extrait || '(vide)'}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

function BlocOutils(p: { outils: OutilVu[] }) {
  const [ouvert, setOuvert] = useState(p.outils.length <= 3);
  return (
    <div className="bloc-outils">
      <button className="bloc-outils-tete" onClick={() => setOuvert(!ouvert)}>
        <span className="titre-pixel">⚙</span> {resumeOutils(p.outils)}
        <span className="bloc-outils-fleche">{ouvert ? '▾' : '▸'}</span>
      </button>
      {ouvert ? p.outils.map((o) => <LigneOutil key={o.appel.id} o={o} />) : null}
    </div>
  );
}

function Reflexion(p: { texte: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <button className="reflexion" onClick={() => setOuvert(!ouvert)}>
      <span>— Réflexion {ouvert ? '▾' : '▸'}</span>
      {ouvert ? <span className="reflexion-texte">{p.texte}</span> : null}
    </button>
  );
}

function VueBloc(p: { b: Bloc }) {
  const b = p.b;
  switch (b.genre) {
    case 'chris':
      return (
        <div className="bulle-chris">
          <div>{b.texte}</div>
          <time>{heure(b.ts)}</time>
        </div>
      );
    case 'claude':
      return <Texte texte={b.texte} />;
    case 'reflexion':
      return <Reflexion texte={b.texte} />;
    case 'outils':
      return <BlocOutils outils={b.outils} />;
    case 'sous_agent':
      return (
        <div className="carte-sous-agent">
          <div className="sa-tete">
            <span className="sa-modele">{b.info.modele || 'agent'}</span>
            <b>{b.info.description}</b>
            <span className="sa-compte">{b.evenements} actions</span>
          </div>
          {b.dernier ? <div className="sa-dernier">{b.dernier}</div> : null}
        </div>
      );
    case 'question':
      return <div className="repere question">? {b.texte}</div>;
    case 'repere':
      return <div className={`repere ${b.niveau}`}>{b.texte}</div>;
  }
}

export function Fil(p: { fil: readonly EvenementDate[] }) {
  const vu = useMemo(() => structurerFil(p.fil), [p.fil]);
  const bas = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const colle = useRef(true);
  useEffect(() => {
    if (colle.current) bas.current?.scrollIntoView({ block: 'end' });
  }, [vu]);
  return (
    <div
      className="fil defile"
      ref={zone}
      onScroll={(e) => {
        const z = e.currentTarget;
        colle.current = z.scrollHeight - z.scrollTop - z.clientHeight < 80;
      }}
    >
      <div className="fil-colonne">
        {vu.blocs.length === 0 ? <div className="fil-vide">Pas encore de messages.</div> : null}
        {vu.blocs.map((b) => <VueBloc key={b.cle} b={b} />)}
        {vu.enCours ? (
          <div className="en-cours">
            <Texte texte={vu.enCours} />
          </div>
        ) : null}
        <div ref={bas} />
      </div>
    </div>
  );
}
