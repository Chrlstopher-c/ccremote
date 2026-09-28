// Responsabilité : l'explorateur de fichiers d'un appareil — fil d'Ariane, liste triée (dossiers d'abord), gestes par
// rangée (renommer, télécharger, supprimer), dépôt par glisser-déposer ou sélection, aperçu à droite.
import {
  ArrowUp,
  Download,
  Eye,
  EyeOff,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Link2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import type { EntreeFichier } from '../../../../commun/appareil.ts';
import { depuis, tailleFichier } from '../../shared/format.ts';
import { IconeBouton } from '../../shared/ui/Bouton.tsx';
import { type Demandes, useDemande } from '../../shared/ui/useDemande.tsx';
import type { ApiAppareil } from '../api-appareil.ts';
import { Apercu } from './Apercu.tsx';
import { apercuDe } from './genre.ts';
import { type Explorateur as Etat, useExplorateur } from './useExplorateur.ts';

function IconeEntree({ e }: { readonly e: EntreeFichier }): ReactNode {
  if (e.type === 'dossier') return <Folder size={14} className="text-accent" />;
  if (e.type === 'lien') return <Link2 size={14} className="text-discret" />;
  const a = apercuDe(e.nom);
  if (a === 'image' || a === 'video') return <FileImage size={14} className="text-discret" />;
  if (a === 'texte') return <FileCode size={14} className="text-discret" />;
  return a === 'markdown' ? (
    <FileText size={14} className="text-discret" />
  ) : (
    <File size={14} className="text-discret" />
  );
}

function FilAriane({ x }: { readonly x: Etat }): ReactNode {
  const chemin = x.liste?.chemin ?? '';
  const morceaux = chemin.split('/').filter(Boolean);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto font-mono text-[12px] text-encre-2">
      <button type="button" className="cursor-default rounded px-1 hover:bg-survol" onClick={() => x.aller('/')}>
        /
      </button>
      {morceaux.map((m, i) => (
        <span key={`${i}-${m}`} className="flex items-center gap-0.5">
          <button
            type="button"
            className="cursor-default truncate rounded px-1 hover:bg-survol"
            onClick={() => x.aller(`/${morceaux.slice(0, i + 1).join('/')}`)}
          >
            {m}
          </button>
          {i < morceaux.length - 1 && <span className="text-discret">/</span>}
        </span>
      ))}
    </div>
  );
}

function Outils({ x, d }: { readonly x: Etat; readonly d: Demandes }): ReactNode {
  const choix = useRef<HTMLInputElement>(null);
  const nouveauDossier = async (): Promise<void> => {
    const nom = await d.nom('Nouveau dossier');
    if (nom) await x.creerDossier(nom);
  };
  const deposer = (liste: FileList | null): void => void x.deposer([...(liste ?? [])]);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-filet px-2">
      <IconeBouton aide="Dossier parent" disabled={!x.liste?.parent}
        onClick={() => x.aller(x.liste?.parent ?? undefined)}>
        <ArrowUp size={14} />
      </IconeBouton>
      <IconeBouton aide="Dossier personnel" onClick={() => x.aller(undefined)}><Home size={14} /></IconeBouton>
      <FilAriane x={x} />
      <IconeBouton aide={x.caches ? 'Masquer les fichiers cachés' : 'Afficher les fichiers cachés'} actif={x.caches}
        onClick={x.basculerCaches}>{x.caches ? <Eye size={14} /> : <EyeOff size={14} />}</IconeBouton>
      <IconeBouton aide="Nouveau dossier" onClick={() => void nouveauDossier()}>
        <FolderPlus size={14} />
      </IconeBouton>
      <IconeBouton aide="Déposer des fichiers ici" onClick={() => choix.current?.click()}>
        <Upload size={14} />
      </IconeBouton>
      <IconeBouton aide="Actualiser" onClick={x.recharger}>
        <RefreshCw size={14} className={x.charge ? 'animate-spin' : ''} />
      </IconeBouton>
      <input ref={choix} type="file" multiple hidden
        onChange={(ev) => { deposer(ev.target.files); ev.target.value = ''; }} />
    </div>
  );
}

interface PropsRangee {
  readonly e: EntreeFichier;
  readonly x: Etat;
  readonly d: Demandes;
  readonly choisie: boolean;
}

function useGestesRangee({ e, x, d }: PropsRangee) {
  return {
    renommer: async (): Promise<void> => {
      const nom = await d.nom('Renommer', e.nom);
      if (nom && nom !== e.nom) await x.renommer(e, nom);
    },
    supprimer: async (): Promise<void> => {
      const tout = e.type === 'dossier' ? ' et tout son contenu' : '';
      const detail = `Le fichier${tout} sera effacé de ${x.machine}, sans corbeille.`;
      const ok = await d.confirmer(`Supprimer « ${e.nom} » ?`, detail);
      if (ok) await x.supprimer(e);
    },
  };
}

function Rangee(p: PropsRangee): ReactNode {
  const { e, x, choisie } = p;
  const g = useGestesRangee(p);
  return (
    <div onClick={() => x.ouvrir(e)} className={`group flex h-8 cursor-default items-center gap-2.5 border-b
      border-filet px-3 text-[13px] ${choisie ? 'bg-choix' : 'hover:bg-survol'} ${e.cache ? 'opacity-60' : ''}`}>
      <IconeEntree e={e} />
      <span className="min-w-0 flex-1 truncate">{e.nom}</span>
      <span className="hidden gap-0.5 group-hover:flex" onClick={(ev) => ev.stopPropagation()}>
        <IconeBouton aide="Renommer" className="size-6" onClick={() => void g.renommer()}>
          <Pencil size={12} />
        </IconeBouton>
        {e.type !== 'dossier' && (
          <IconeBouton aide="Télécharger" className="size-6" onClick={() => void x.telecharger(e)}>
            <Download size={12} />
          </IconeBouton>
        )}
        <IconeBouton aide="Supprimer" ton="danger" className="size-6" onClick={() => void g.supprimer()}>
          <Trash2 size={12} />
        </IconeBouton>
      </span>
      <span className="w-20 text-right font-mono text-[11px] text-discret">
        {e.type === 'dossier' ? '' : tailleFichier(e.taille)}
      </span>
      <span className="w-28 text-right font-mono text-[11px] text-discret">{depuis(e.modifie)}</span>
    </div>
  );
}

export function ExplorateurFichiers({ api }: { readonly api: ApiAppareil }): ReactNode {
  const x = useExplorateur(api);
  const d = useDemande();
  const [survol, setSurvol] = useState(false);
  return (
    <div className="flex min-h-0 flex-1">
      <div
        className={`flex min-w-0 flex-1 flex-col ${survol ? 'outline-2 -outline-offset-2 outline-accent' : ''}`}
        onDragOver={(ev) => {
          ev.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(ev) => {
          ev.preventDefault();
          setSurvol(false);
          void x.deposer([...ev.dataTransfer.files]);
        }}
      >
        <Outils x={x} d={d} />
        {x.message && (
          <p className="border-b border-filet px-3 py-1.5 font-mono text-[11.5px] text-accent-texte">{x.message}</p>
        )}
        <div className="selectionnable min-h-0 flex-1 overflow-y-auto">
          {x.entrees.map((e) => (
            <Rangee key={e.nom} e={e} x={x} d={d} choisie={x.ouvert?.entree.nom === e.nom} />
          ))}
          {x.liste && x.entrees.length === 0 && <p className="p-4 text-[12.5px] text-discret">Dossier vide.</p>}
        </div>
      </div>
      {d.rendu}
      {x.ouvert && <Apercu key={x.ouvert.chemin} api={api} fichier={x.ouvert} surFermer={x.fermer} />}
    </div>
  );
}
