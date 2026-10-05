// Responsabilité : voir une image du fil en grand (clic) et agir dessus (clic droit) — l'agrandir, l'enregistrer,
// l'ouvrir dans le navigateur.
import { Download, ExternalLink, Maximize2, X } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { enregistrerFichier, ouvrirDansNavigateur } from '../../shared/natif.ts';

export interface ImageChargee {
  readonly url: string;
  readonly blob: Blob;
  readonly nom: string;
}

/** Échap ferme ; utilisé par la visionneuse et le menu. */
function useEchap(fermer: () => void): void {
  useEffect(() => {
    const surTouche = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') fermer();
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [fermer]);
}

export function Visionneuse({
  image,
  fermer,
}: {
  readonly image: ImageChargee;
  readonly fermer: () => void;
}): ReactNode {
  useEchap(fermer);
  return createPortal(
    <div
      role="dialog"
      aria-label={image.nom}
      onClick={fermer}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/85 p-6"
    >
      <img
        src={image.url}
        alt={image.nom}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[94vw] rounded-[6px] object-contain shadow-2xl"
      />
      <div className="flex items-center gap-3 font-mono text-[11.5px] text-white/80">
        <span>{image.nom}</span>
        <button type="button" aria-label="Fermer" onClick={fermer} className="rounded p-1 hover:bg-white/10">
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface PropsMenu {
  readonly image: ImageChargee;
  readonly x: number;
  readonly y: number;
  readonly agrandir: () => void;
  readonly fermer: () => void;
}

function Entree({
  icone,
  libelle,
  agir,
}: {
  readonly icone: ReactNode;
  readonly libelle: string;
  readonly agir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={agir}
      className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-[12.5px] hover:bg-survol"
    >
      {icone}
      {libelle}
    </button>
  );
}

function useActionsImage(image: ImageChargee, fermer: () => void) {
  const [note, setNote] = useState<string | null>(null);
  const enregistrer = async (): Promise<void> => {
    const r = await enregistrerFichier(image.nom, image.blob);
    setNote('erreur' in r ? r.erreur : `Enregistré : ${r.chemin}`);
    setTimeout(fermer, 2500);
  };
  const ouvrir = async (): Promise<void> => {
    const erreur = await ouvrirDansNavigateur(image.nom, image.blob);
    if (erreur) setNote(erreur);
    else fermer();
  };
  return { note, enregistrer, ouvrir };
}

export function MenuImage({ image, x, y, agrandir, fermer }: PropsMenu): ReactNode {
  const { note, enregistrer, ouvrir } = useActionsImage(image, fermer);
  useEchap(fermer);
  const arreter = (e: MouseEvent): void => e.stopPropagation();
  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onClick={fermer}
      onContextMenu={(e) => {
        e.preventDefault();
        fermer();
      }}
    >
      <div
        onClick={arreter}
        style={{ left: Math.min(x, window.innerWidth - 260), top: Math.min(y, window.innerHeight - 160) }}
        className="absolute w-[250px] rounded-[8px] border border-filet bg-fond p-1 shadow-xl"
      >
        <Entree
          icone={<Maximize2 size={13} />}
          libelle="Agrandir"
          agir={() => {
            fermer();
            agrandir();
          }}
        />
        <Entree icone={<Download size={13} />} libelle="Télécharger" agir={() => void enregistrer()} />
        <Entree icone={<ExternalLink size={13} />} libelle="Ouvrir dans le navigateur" agir={() => void ouvrir()} />
        {note && <p className="px-2.5 py-1 font-mono text-[10.5px] break-all text-discret">{note}</p>}
      </div>
    </div>,
    document.body,
  );
}
