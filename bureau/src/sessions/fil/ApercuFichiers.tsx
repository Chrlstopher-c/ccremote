// Responsabilité : les fichiers présentés par un appel d'outil, montrés dans le fil — l'image s'affiche, le reste est
// proposé au téléchargement. Les octets viennent de la machine de la session par l'API du relais (4G, web, iPhone).
import { Download, FileText, ImageOff } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { ApiAppareil } from '../../appareils/api-appareil.ts';
import { apercuDe } from '../../appareils/fichiers/genre.ts';
import { useMagasin } from '../../shared/etat/contexte.tsx';
import { type ImageChargee, MenuImage, Visionneuse } from './Visionneuse.tsx';

/** La machine de la session affichée : d'où lire les fichiers. */
export const ContexteMachine = createContext('');

function nomDe(chemin: string): string {
  return chemin.slice(chemin.lastIndexOf('/') + 1);
}

type EtatImage = ImageChargee | { readonly erreur: string } | null;

function useImage(api: ApiAppareil, chemin: string): EtatImage {
  const [etat, setEtat] = useState<EtatImage>(null);
  useEffect(() => {
    let url: string | null = null;
    let actif = true;
    api
      .lire(chemin)
      .then((blob) => {
        if (actif) setEtat({ url: (url = URL.createObjectURL(blob)), blob, nom: nomDe(chemin) });
      })
      .catch((e: unknown) => actif && setEtat({ erreur: e instanceof Error ? e.message : String(e) }));
    return () => {
      actif = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, chemin]);
  return etat;
}

// Clic : en grand. Clic droit : agrandir, télécharger, ouvrir dans le navigateur.
function Image({ api, chemin }: { readonly api: ApiAppareil; readonly chemin: string }): ReactNode {
  const etat = useImage(api, chemin);
  const [grand, setGrand] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (etat === null) return <div className="h-24 w-48 animate-pulse rounded-[6px] bg-champ" />;
  if ('erreur' in etat)
    return (
      <div className="flex items-center gap-1.5 text-[11.5px] text-discret">
        <ImageOff size={13} />
        {`${nomDe(chemin)} — ${etat.erreur}`}
      </div>
    );
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setGrand(true)}
        onKeyDown={(e) => e.key === 'Enter' && setGrand(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className="cursor-zoom-in"
      >
        <img src={etat.url} alt={etat.nom} className="max-h-80 max-w-full rounded-[6px] border border-filet" />
      </div>
      {grand && <Visionneuse image={etat} fermer={() => setGrand(false)} />}
      {menu && (
        <MenuImage image={etat} x={menu.x} y={menu.y} agrandir={() => setGrand(true)} fermer={() => setMenu(null)} />
      )}
    </>
  );
}

function CarteFichier({ api, chemin }: { readonly api: ApiAppareil; readonly chemin: string }): ReactNode {
  return (
    <button
      type="button"
      onClick={() => void api.telecharger(chemin, nomDe(chemin))}
      title={chemin}
      className="flex items-center gap-2 rounded-[6px] border border-filet px-2.5 py-1.5 text-[12px] hover:bg-survol"
    >
      <FileText size={14} className="text-accent-texte" />
      <span className="font-mono">{nomDe(chemin)}</span>
      <Download size={12} className="text-discret" />
    </button>
  );
}

export function ApercuFichiers({ chemins }: { readonly chemins: readonly string[] }): ReactNode {
  const machine = useContext(ContexteMachine);
  const { client } = useMagasin();
  const api = useMemo(() => new ApiAppareil(client, machine), [client, machine]);
  if (!machine || chemins.length === 0) return null;
  return (
    <div className="mt-1 mb-2 ml-4 flex flex-wrap items-start gap-2">
      {chemins.map((c) =>
        apercuDe(nomDe(c)) === 'image' ? (
          <Image key={c} api={api} chemin={c} />
        ) : (
          <CarteFichier key={c} api={api} chemin={c} />
        ),
      )}
    </div>
  );
}
