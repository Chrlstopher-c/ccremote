// Responsabilité : la barre du mode Echo — état, et les trois bascules : micro, voix, discussion écrite.
import { AudioLines, MessageSquareText, Mic, MicOff, Square, Volume2, VolumeX } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CommandeVoix, EtatVoixEcho, McpEcho, ReglagesEcho, UsageEcho } from '../../../commun/echo.ts';
import { PanneauOutils } from './PanneauOutils.tsx';
import { PastilleVoix } from './PastilleVoix.tsx';
import type { Disponibilite } from './useEcho.ts';

const ETATS: Record<Disponibilite, string> = {
  chargement: 'connexion…',
  ok: 'à l’écoute',
  injoignable: 'injoignable',
  absente: 'non configurée sur ce relais',
};

const BOUTON = 'grid size-8 cursor-default place-items-center rounded-[10px] transition-colors';
const ALLUME = 'bg-accent-fond text-accent-texte';
const ETEINT = 'text-discret hover:bg-survol hover:text-encre';

interface PropsBascule {
  readonly actif: boolean;
  readonly titre: string;
  readonly surClic: () => void;
  readonly children: ReactNode;
}

function Bascule(p: PropsBascule): ReactNode {
  return (
    <button
      type="button"
      onClick={p.surClic}
      title={p.titre}
      aria-label={p.titre}
      aria-pressed={p.actif}
      className={`${BOUTON} ${p.actif ? ALLUME : ETEINT}`}
    >
      {p.children}
    </button>
  );
}

interface PropsBarre {
  readonly dispo: Disponibilite;
  readonly occupe: boolean;
  readonly reglages: ReglagesEcho;
  readonly discussion: boolean;
  readonly regler: (r: Partial<ReglagesEcho>) => void;
  readonly basculerDiscussion: () => void;
  readonly interrompre: () => void;
  readonly voix: EtatVoixEcho | null;
  readonly commanderVoix: (a: CommandeVoix) => void;
  readonly usage: UsageEcho | null;
  readonly mcp: readonly McpEcho[];
  readonly relancer: () => void;
}

const milliers = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));

/** Ce qu'Echo a consommé aujourd'hui : discret, le détail au survol. */
function Conso({ u }: { readonly u: UsageEcho | null }): ReactNode {
  if (!u || u.tours === 0) return null;
  const detail = `Aujourd'hui : ${u.tours} tours, ${milliers(u.entree)} jetons en entrée, ${milliers(u.sortie)} en sortie, ${milliers(u.cache)} relus du cache — équivalent API ${u.dollars.toFixed(2)} $`;
  return (
    <span title={detail} className="font-mono text-[10.5px] text-discret">
      {u.tours} tours · {u.dollars.toFixed(2)} $
    </span>
  );
}

function Bascules(p: PropsBarre): ReactNode {
  const { micro, voix } = p.reglages;
  return (
    <>
      {p.occupe && (
        <Bascule actif={false} titre="Interrompre Echo" surClic={p.interrompre}>
          <Square size={13} />
        </Bascule>
      )}
      <Bascule
        actif={!micro}
        titre={micro ? 'Couper le micro' : 'Rouvrir le micro'}
        surClic={() => p.regler({ micro: !micro })}
      >
        {micro ? <Mic size={15} /> : <MicOff size={15} />}
      </Bascule>
      <Bascule
        actif={!voix}
        titre={voix ? 'Couper la voix d’Echo' : 'Rendre la voix à Echo'}
        surClic={() => p.regler({ voix: !voix })}
      >
        {voix ? <Volume2 size={15} /> : <VolumeX size={15} />}
      </Bascule>
      <Bascule actif={p.discussion} titre="Discussion écrite" surClic={p.basculerDiscussion}>
        <MessageSquareText size={15} />
      </Bascule>
    </>
  );
}

export function BarreEcho(p: PropsBarre): ReactNode {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-filet px-4 py-2">
      <AudioLines size={15} className="text-accent-texte" />
      <h1 className="text-[14px] font-extrabold tracking-[-0.02em] text-encre">Echo</h1>
      <span className="font-mono text-[10.5px] text-discret">
        {p.occupe ? 'réfléchit' : p.dispo === 'ok' && !p.reglages.micro ? 'micro coupé' : ETATS[p.dispo]}
      </span>
      <div className="flex-1" />
      <Conso u={p.usage} />
      <PastilleVoix voix={p.voix} commander={p.commanderVoix} />
      <PanneauOutils mcp={p.mcp} relancer={p.relancer} />
      <Bascules {...p} />
    </header>
  );
}
