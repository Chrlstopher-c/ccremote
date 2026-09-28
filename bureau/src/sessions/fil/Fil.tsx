// Responsabilité : le fil d'une session — chargé à l'ouverture, prolongé en direct, collé en bas tant qu'on y est.
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useEtat, useMagasin } from '../../shared/etat/contexte.tsx';
import { CarteOutil, CarteSousAgent, ContexteDossier } from './cartes-outils.tsx';
import { ElementSimple } from './ElementSimple.tsx';
import { structurer } from './structure.ts';

const VIDE: never[] = [];

// Suit le bas du fil quand on y est déjà ; laisse lire tranquillement quand on est remonté.
function useCollant(taille: number) {
  const ref = useRef<HTMLDivElement>(null);
  const colle = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const surDefilement = (): void => {
      colle.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', surDefilement);
    return () => el.removeEventListener('scroll', surDefilement);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && colle.current) el.scrollTop = el.scrollHeight;
  }, [taille]);
  return ref;
}

export function Fil({ sessionId, dossier }: { readonly sessionId: string; readonly dossier: string }): ReactNode {
  const magasin = useMagasin();
  const evts = useEtat((e) => e.fils.get(sessionId) ?? VIDE);
  const elements = useMemo(() => structurer(evts), [evts]);
  const zone = useCollant(elements.length);

  useEffect(() => {
    void magasin.chargerFil(sessionId);
  }, [magasin, sessionId]);

  return (
    <div ref={zone} className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
      <ContexteDossier.Provider value={dossier}>
        <div className="mx-auto max-w-[860px]">
          {elements.length === 0 && <p className={`py-12 text-center
            text-[12px] text-discret`}>Fil vide pour l’instant.</p>}
          {elements.map((el) => {
            if (el.genre === 'outil') return <CarteOutil key={el.seq} el={el} />;
            if (el.genre === 'sous_agent') return <CarteSousAgent key={el.seq} el={el} />;
            return <ElementSimple key={el.seq} evt={el.evt} ts={el.ts} />;
          })}
        </div>
      </ContexteDossier.Provider>
    </div>
  );
}
