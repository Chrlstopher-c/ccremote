// Responsabilité : la colonne « ce que l'agent a touché » de l'écran d'agent — fichiers créés ou modifiés en avant
// (un clic les ouvre), fichiers seulement lus en rayon secondaire, pages web, et la frise des dernières actions.
import { useMemo, useState } from 'react';

import type { EvenementDate } from '../../donnees';
import { fileEvenements, indexerBibliotheque, type Ressource } from '../../donnees';
import { ouvrir } from '../bus';

const ICONE: Record<string, string> = {
  lecture: '👁', ecriture: '✚', modification: '✎', suppression: '✕', recherche: '⌕', commande: '$', web: '◍',
};

const court = (chemin: string): string => chemin.split('/').slice(-2).join('/');

function Liste(p: { titre: string; items: readonly Ressource[]; machine: string; sessionId: string; max?: number }) {
  const [tout, setTout] = useState(false);
  if (!p.items.length) return null;
  const vus = tout ? p.items : p.items.slice(0, p.max ?? 8);
  return (
    <div className="touches-groupe">
      <div className="touches-titre titre-pixel">{p.titre} <span>{p.items.length}</span></div>
      {vus.map((r) => (
        <button
          key={r.cible}
          className={`touche ${r.ecrite ? 'ecrite' : ''}`}
          title={r.cible}
          onClick={() => r.genre === 'fichier' && ouvrir({ type: 'fichiers', machine: p.machine, chemin: r.cible,
            sessionId: p.sessionId })}
        >
          <span className="touche-nom">{r.genre === 'fichier' ? court(r.cible) : r.cible}</span>
          <span className="touche-n">{r.touches}</span>
        </button>
      ))}
      {p.items.length > vus.length ? (
        <button className="touches-plus" onClick={() => setTout(true)}>+ {p.items.length - vus.length}</button>
      ) : null}
    </div>
  );
}

export function Touches(p: { fil: readonly EvenementDate[]; machine: string; sessionId: string }) {
  const b = useMemo(() => indexerBibliotheque(p.fil), [p.fil]);
  const frise = useMemo(() => fileEvenements(p.fil).slice(-14).reverse(), [p.fil]);
  return (
    <aside className="touches defile">
      <Liste titre="Créés / modifiés" items={b.enAvant} machine={p.machine} sessionId={p.sessionId} />
      <Liste titre="Lus" items={b.lues} machine={p.machine} sessionId={p.sessionId} max={5} />
      <Liste titre="Web" items={b.web} machine={p.machine} sessionId={p.sessionId} max={4} />
      {frise.length ? (
        <div className="touches-groupe">
          <div className="touches-titre titre-pixel">Frise</div>
          {frise.map((t, i) => (
            <div key={`${t.ts}${i}`} className={`frise-ligne ${t.type}`}>
              <span className="frise-icone">{ICONE[t.type] ?? '·'}</span>
              <span className="frise-cible">{court(t.cible)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="touches-vide">Rien de touché pour l'instant.</div>
      )}
    </aside>
  );
}
