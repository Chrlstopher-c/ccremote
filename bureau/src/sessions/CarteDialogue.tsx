// Responsabilité : un dialogue du TUI en attente (AskUserQuestion, permission, plan) — le lire et y répondre depuis
// Quart, comme au clavier. Une question à la fois : la suivante apparaît dès que le TUI l'affiche.
import { MessageCircleQuestion } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Dialogue, ReponseDialogue } from '../../../commun/session.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';

interface Props {
  readonly dialogue: Dialogue;
  readonly repondable: boolean;
  readonly repondre: (r: ReponseDialogue) => Promise<boolean>;
}

function Libelle({ o }: { readonly o: Dialogue['options'][number] }): ReactNode {
  return (
    <span className="min-w-0 text-left">
      <span className="block text-[13px] font-semibold text-encre">{o.libelle}</span>
      {o.description && <span className="block text-[12px] font-normal text-discret">{o.description}</span>}
    </span>
  );
}

function ChampLibre(p: {
  readonly valeur: string;
  readonly changer: (v: string) => void;
  readonly valider?: () => void;
}): ReactNode {
  return (
    <input value={p.valeur} placeholder="Autre réponse…" onChange={(e) => p.changer(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && p.valider) p.valider(); }}
      className="h-7 rounded-[6px] bg-champ px-2 text-[12.5px] outline-none placeholder:text-discret" />
  );
}

function ChoixUnique({ dialogue: d, repondable, repondre }: Props): ReactNode {
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const envoyer = async (r: Omit<ReponseDialogue, 'id'>): Promise<void> => {
    setEnvoi(true);
    await repondre({ id: d.id, ...r });
    setEnvoi(false);
  };
  return (
    <>
      {d.options.map((o, i) => i !== d.saisie && (
        <button key={i} type="button" disabled={!repondable || envoi} onClick={() => void envoyer({ index: i })}
          className={`flex cursor-default items-start gap-2 rounded-[6px] px-2 py-1.5
            hover:bg-survol disabled:opacity-60`}>
          <span className="w-4 shrink-0 pt-px font-mono text-[11px] text-discret">{i + 1}</span>
          <Libelle o={o} />
        </button>
      ))}
      {d.saisie !== null && repondable && (
        <div className="flex gap-2 px-2">
          <div className="flex flex-1 flex-col"><ChampLibre valeur={texte} changer={setTexte}
            valider={() => texte.trim() && void envoyer({ texte })} /></div>
          <Bouton disabled={!texte.trim() || envoi} onClick={() => void envoyer({ texte })}>Envoyer</Bouton>
        </div>
      )}
    </>
  );
}

function Cases({ dialogue: d, repondable, repondre }: Props): ReactNode {
  const [cases, setCases] = useState<number[]>(d.coches.filter((c) => c !== d.saisie));
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const basculer = (i: number): void => setCases((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  const valider = async (): Promise<void> => {
    setEnvoi(true);
    await repondre({ id: d.id, cases, ...(texte.trim() ? { texte: texte.trim() } : {}) });
    setEnvoi(false);
  };
  return (
    <>
      {d.options.map((o, i) => i !== d.saisie && (
        <label key={i} className="flex cursor-default items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-survol">
          <input type="checkbox" checked={cases.includes(i)} disabled={!repondable} onChange={() => basculer(i)}
            className="mt-0.5 accent-[var(--accent)]" />
          <Libelle o={o} />
        </label>
      ))}
      {repondable && (
        <div className="flex gap-2 px-2">
          <div className="flex flex-1 flex-col">
            {d.saisie !== null && <ChampLibre valeur={texte} changer={setTexte} />}
          </div>
          <Bouton ton="accent" disabled={envoi || (cases.length === 0 && !texte.trim())}
            onClick={() => void valider()}>Valider</Bouton>
        </div>
      )}
    </>
  );
}

export function CarteDialogue(p: Props): ReactNode {
  return (
    <div className={`flex max-h-[45%] shrink-0 flex-col gap-1 overflow-y-auto border-t
      border-filet bg-accent-fond px-4 py-3`}>
      <div className="flex items-center gap-2 pb-1 text-[12px] font-semibold text-accent-texte">
        <MessageCircleQuestion size={14} />
        Claude attend ta réponse
        {!p.repondable && <span className="font-normal text-discret">· machine hors ligne</span>}
      </div>
      {p.dialogue.titre && (
        <p className="whitespace-pre-wrap px-2 pb-1 text-[13px] font-bold text-encre">{p.dialogue.titre}</p>
      )}
      {p.dialogue.multiple ? <Cases {...p} key={p.dialogue.id} /> : <ChoixUnique {...p} key={p.dialogue.id} />}
    </div>
  );
}
