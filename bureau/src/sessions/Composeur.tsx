// Responsabilité : écrire à une session — Entrée envoie, Maj+Entrée va à la ligne ; reprend une session fermée.
import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';

function aide(s: ResumeSession): string {
  if (s.tmux === null) return 'La session est fermée : ce message la reprendra.';
  if (s.statut === 'travail' || s.statut === 'compaction')
    return 'Claude travaille : le message sera lu à la fin de son tour.';
  return 'Entrée pour envoyer, Maj+Entrée pour aller à la ligne.';
}

function useComposeur(envoyer: (t: string) => Promise<boolean>, occupe: boolean) {
  const [texte, setTexte] = useState('');
  async function soumettre(): Promise<void> {
    const t = texte.trim();
    if (!t || occupe) return;
    if (await envoyer(t)) setTexte('');
  }
  function touche(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    void soumettre();
  }
  return { texte, setTexte, soumettre, touche };
}

function BoutonEnvoyer({ actif, surEnvoyer }: { readonly actif: boolean; readonly surEnvoyer: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={surEnvoyer}
      disabled={!actif}
      aria-label="Envoyer"
      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-white
        shadow-[0_3px_0_var(--accent-relief)] transition-all active:translate-y-[3px] active:shadow-none
        disabled:opacity-40"
    >
      <ArrowUp size={19} strokeWidth={2.4} />
    </button>
  );
}

interface PropsComposeur {
  readonly session: ResumeSession;
  readonly envoyer: (t: string) => Promise<boolean>;
  readonly occupe: boolean;
}

export function Composeur({ session, envoyer, occupe }: PropsComposeur): ReactNode {
  const c = useComposeur(envoyer, occupe);
  return (
    <div className="border-t border-filet bg-surface px-8 py-4">
      <div className="mx-auto flex max-w-[820px] items-end gap-3">
        <textarea
          value={c.texte}
          onChange={(e) => c.setTexte(e.target.value)}
          onKeyDown={c.touche}
          rows={Math.min(8, Math.max(1, c.texte.split('\n').length))}
          placeholder={`Écrire à « ${session.titre} »`}
          aria-label="Message"
          className="min-h-[44px] flex-1 resize-none rounded-[14px] bg-surface-2 px-4 py-3 text-[14.5px]
            leading-relaxed outline-none placeholder:text-discret focus:ring-2 focus:ring-accent-vif"
        />
        <BoutonEnvoyer actif={!!c.texte.trim() && !occupe} surEnvoyer={() => void c.soumettre()} />
      </div>
      <p className="mx-auto mt-2 max-w-[820px] pl-1 font-mono text-[11px] text-discret">{aide(session)}</p>
    </div>
  );
}
