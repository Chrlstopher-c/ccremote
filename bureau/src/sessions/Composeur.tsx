// Responsabilité : écrire à une session — Entrée envoie, Maj+Entrée va à la ligne ; reprend une session fermée.
import { CornerDownLeft } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';

function aide(s: ResumeSession): string {
  if (s.tmux === null) return 'Session fermée : écrire la reprend';
  if (s.statut === 'travail' || s.statut === 'compaction') return 'Claude travaille : lu à la fin de son tour';
  return `Écrire à « ${s.titre} »`;
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

interface PropsComposeur {
  readonly session: ResumeSession;
  readonly envoyer: (t: string) => Promise<boolean>;
  readonly occupe: boolean;
}

export function Composeur({ session, envoyer, occupe }: PropsComposeur): ReactNode {
  const c = useComposeur(envoyer, occupe);
  const zone = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const focus = (): void => zone.current?.focus();
    window.addEventListener('ccremote:ecrire', focus);
    return () => window.removeEventListener('ccremote:ecrire', focus);
  }, []);
  return (
    <div className="flex shrink-0 items-end gap-2 border-t border-filet px-4 py-2.5">
      <textarea ref={zone} value={c.texte} onChange={(e) => c.setTexte(e.target.value)} onKeyDown={c.touche}
        rows={Math.min(8, Math.max(1, c.texte.split('\n').length))} placeholder={aide(session)} aria-label="Message"
        className={`min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed outline-none
          select-text placeholder:text-discret`} />
      <button type="button" onClick={() => void c.soumettre()} disabled={!c.texte.trim() || occupe}
        title="Envoyer (Entrée)" aria-label="Envoyer"
        className={`grid size-7 cursor-default place-items-center
          rounded-[6px] bg-accent text-white disabled:opacity-30`}>
        <CornerDownLeft size={14} />
      </button>
    </div>
  );
}
