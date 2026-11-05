// Responsabilité : un texte à recopier tel quel (URL, commande) avec son bouton « Copier ».
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { journal } from '../shared/journal.ts';

export function BlocCopie({ texte, libelle }: { readonly texte: string; readonly libelle: string }): ReactNode {
  const [copie, setCopie] = useState(false);
  const copier = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 1600);
    } catch (e) {
      journal.warn({ erreur: String(e) }, 'presse-papiers indisponible');
    }
  };
  return (
    <div className="flex items-start gap-2 rounded-[6px] bg-champ p-2">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[11.5px] leading-relaxed text-encre">
        {texte}
      </code>
      <button type="button" onClick={() => void copier()} aria-label={`Copier ${libelle}`} title={`Copier ${libelle}`}
        className="grid size-6 shrink-0 cursor-default place-items-center rounded-[5px] text-discret
          hover:bg-survol hover:text-encre">
        {copie ? <Check size={13} className="text-succes" /> : <Copy size={13} />}
      </button>
    </div>
  );
}
