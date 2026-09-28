// Responsabilité : l'aperçu d'un fichier de l'appareil — image, vidéo, son, PDF affichés ; texte, code, scripts et
// Markdown ouverts dans l'éditeur (enregistrement sur l'appareil) ; le reste proposé au téléchargement.
import { Download, Maximize2, Minimize2, X } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { TAILLE_MAX_EDITION } from '../../../../commun/appareil.ts';
import { ErreurApi } from '../../shared/api/client.ts';
import { tailleFichier } from '../../shared/format.ts';
import { IconeBouton } from '../../shared/ui/Bouton.tsx';
import type { ApiAppareil } from '../api-appareil.ts';
import { apercuDe } from './genre.ts';
import type { FichierOuvert } from './useExplorateur.ts';

// CodeMirror ne se charge qu'au premier fichier texte ouvert : le reste de l'app n'en paie pas le poids.
const Editeur = lazy(() => import('./Editeur.tsx'));

type Contenu =
  | { readonly genre: 'chargement' }
  | { readonly genre: 'erreur'; readonly message: string }
  | { readonly genre: 'url'; readonly url: string }
  | { readonly genre: 'texte'; readonly texte: string }
  | { readonly genre: 'rien' };

function useContenu(api: ApiAppareil, f: FichierOuvert): Contenu {
  const [contenu, setContenu] = useState<Contenu>({ genre: 'chargement' });
  useEffect(() => {
    const a = apercuDe(f.entree.nom);
    const texte = a === 'texte' || a === 'markdown';
    if (a === 'binaire' || (texte && f.entree.taille > TAILLE_MAX_EDITION)) return setContenu({ genre: 'rien' });
    let url: string | null = null;
    let actif = true;
    const charger = texte
      ? api.lireTexte(f.chemin).then((t): Contenu => ({ genre: 'texte', texte: t }))
      : api.lire(f.chemin).then((b): Contenu => ({ genre: 'url', url: (url = URL.createObjectURL(b)) }));
    charger
      .then((c) => actif && setContenu(c))
      .catch(
        (e: unknown) =>
          actif && setContenu({ genre: 'erreur', message: e instanceof ErreurApi ? e.message : String(e) }),
      );
    return () => {
      actif = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, f]);
  return contenu;
}

function Corps({
  api,
  f,
  c,
}: {
  readonly api: ApiAppareil;
  readonly f: FichierOuvert;
  readonly c: Contenu;
}): ReactNode {
  const a = apercuDe(f.entree.nom);
  if (c.genre === 'chargement') return <p className="p-4 text-[12.5px] text-discret">Chargement…</p>;
  if (c.genre === 'erreur') return <p className="p-4 font-mono text-[12px] text-danger">{c.message}</p>;
  if (c.genre === 'rien') {
    return (
      <p className="p-4 text-[12.5px] text-discret">
        Pas d’aperçu pour ce fichier ({tailleFichier(f.entree.taille)}) — télécharge-le.
      </p>
    );
  }
  if (c.genre === 'texte') {
    return (
      <Suspense fallback={<p className="p-4 text-[12.5px] text-discret">Ouverture de l’éditeur…</p>}>
        <Editeur api={api} chemin={f.chemin} nom={f.entree.nom} texte={c.texte} markdown={a === 'markdown'} />
      </Suspense>
    );
  }
  if (a === 'image')
    return <img src={c.url} alt={f.entree.nom} className="m-auto max-h-full max-w-full object-contain p-3" />;
  if (a === 'video') return <video src={c.url} controls className="m-auto max-h-full max-w-full p-3" />;
  if (a === 'audio') return <audio src={c.url} controls className="m-auto w-[90%]" />;
  return <iframe src={c.url} title={f.entree.nom} className="h-full w-full border-0" />;
}

export function Apercu({
  api,
  fichier,
  surFermer,
}: {
  readonly api: ApiAppareil;
  readonly fichier: FichierOuvert;
  readonly surFermer: () => void;
}): ReactNode {
  const contenu = useContenu(api, fichier);
  const [large, setLarge] = useState(false);
  return (
    <aside className={`flex min-h-0 shrink-0 flex-col border-l border-filet bg-fond ${large ? 'w-[70%]' : 'w-[46%]'}`}>
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-filet pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={fichier.chemin}>
          {fichier.entree.nom}
        </span>
        <span className="font-mono text-[11px] text-discret">{tailleFichier(fichier.entree.taille)}</span>
        <IconeBouton aide="Télécharger" onClick={() => void api.telecharger(fichier.chemin, fichier.entree.nom)}>
          <Download size={14} />
        </IconeBouton>
        <IconeBouton aide={large ? 'Réduire' : 'Agrandir'} onClick={() => setLarge((l) => !l)}>
          {large ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconeBouton>
        <IconeBouton aide="Fermer" onClick={surFermer}>
          <X size={14} />
        </IconeBouton>
      </header>
      <div className="flex min-h-0 flex-1 overflow-auto">
        <Corps api={api} f={fichier} c={contenu} />
      </div>
    </aside>
  );
}
