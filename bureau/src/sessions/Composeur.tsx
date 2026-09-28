// Responsabilité : écrire à une session — Entrée envoie, Maj+Entrée va à la ligne ; reprend une session fermée.
import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';

export function Composeur({ session, envoyer, occupe }: {
  readonly session: ResumeSession; readonly envoyer: (t: string) => Promise<boolean>; readonly occupe: boolean;
}): ReactNode {
  const [texte, setTexte] = useState('');
  const travaille = session.statut === 'travail' || session.statut === 'compaction';

  async function soumettre(): Promise<void> {
    const t = texte.trim();
    if (!t || occupe) return;
    if (await envoyer(t)) setTexte('');
  }

  function touche(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void soumettre();
    }
  }

  const aide = session.tmux === null ? 'La session est fermée : ce message la reprendra.'
    : travaille ? 'Claude travaille : le message sera lu à la fin de son tour.' : 'Entrée pour envoyer, Maj+Entrée pour aller à la ligne.';

  return (
    <div className="border-t border-filet bg-surface px-8 py-4">
      <div className="mx-auto flex max-w-[820px] items-end gap-3">
        <textarea value={texte} onChange={(e) => setTexte(e.target.value)} onKeyDown={touche} rows={Math.min(8, Math.max(1, texte.split('\n').length))}
          placeholder={`Écrire à « ${session.titre} »`} aria-label="Message"
          className="min-h-[44px] flex-1 resize-none rounded-[14px] bg-surface-2 px-4 py-3 text-[14.5px] leading-relaxed outline-none
            placeholder:text-discret focus:ring-2 focus:ring-accent-vif" />
        <button type="button" onClick={() => void soumettre()} disabled={!texte.trim() || occupe} aria-label="Envoyer"
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-white shadow-[0_3px_0_var(--accent-relief)]
            transition-all active:translate-y-[3px] active:shadow-none disabled:opacity-40">
          <ArrowUp size={19} strokeWidth={2.4} />
        </button>
      </div>
      <p className="mx-auto mt-2 max-w-[820px] pl-1 font-mono text-[11px] text-discret">{aide}</p>
    </div>
  );
}
