// Responsabilité : un dialogue du TUI en attente (AskUserQuestion, permission, plan) — le lire et y répondre depuis
// Quart, comme au clavier. Une session de terminal ou d'une machine éteinte le montre sans permettre d'y répondre.
import { MessageCircleQuestion } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Dialogue, QuestionDialogue, ReponseDialogue } from '../../../commun/session.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';

type Questions = Extract<Dialogue, { genre: 'questions' }>;
type Choix = Extract<Dialogue, { genre: 'choix' }>;
interface Saisie {
  readonly choix: number[];
  readonly autre: string;
}

interface Props {
  readonly dialogue: Dialogue;
  readonly repondable: boolean;
  readonly repondre: (r: ReponseDialogue) => Promise<boolean>;
}

function OptionQuestion(p: {
  readonly q: QuestionDialogue;
  readonly i: number;
  readonly coche: boolean;
  readonly basculer: () => void;
}): ReactNode {
  const o = p.q.options[p.i];
  return (
    <label className="flex cursor-default items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-survol">
      <input type={p.q.multiple ? 'checkbox' : 'radio'} checked={p.coche} onChange={p.basculer}
        className="mt-0.5 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-encre">{o?.libelle}</span>
        {o?.description && <span className="block text-[12px] text-discret">{o.description}</span>}
      </span>
    </label>
  );
}

function BlocQuestion(p: {
  readonly q: QuestionDialogue;
  readonly s: Saisie;
  readonly changer: (s: Saisie) => void;
}): ReactNode {
  const basculer = (i: number): void => {
    const choix = p.q.multiple
      ? p.s.choix.includes(i) ? p.s.choix.filter((c) => c !== i) : [...p.s.choix, i]
      : [i];
    p.changer({ choix, autre: p.q.multiple ? p.s.autre : '' });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        {p.q.entete && <span className="font-mono text-[10.5px] uppercase text-accent-texte">{p.q.entete}</span>}
        <span className="text-[13px] font-bold text-encre">{p.q.question}</span>
      </div>
      {p.q.options.map((_, i) => (
        <OptionQuestion key={i} q={p.q} i={i} coche={p.s.choix.includes(i)} basculer={() => basculer(i)} />
      ))}
      <input value={p.s.autre} placeholder="Autre réponse…"
        onChange={(e) => p.changer({ choix: p.q.multiple ? p.s.choix : [], autre: e.target.value })}
        className="mx-2 h-7 rounded-[6px] bg-champ px-2 text-[12.5px] outline-none placeholder:text-discret" />
    </div>
  );
}

function FormulaireQuestions({ d, repondable, repondre }: Props & { readonly d: Questions }): ReactNode {
  const [saisies, setSaisies] = useState<Saisie[]>(() => d.questions.map(() => ({ choix: [], autre: '' })));
  const [envoi, setEnvoi] = useState(false);
  const complet = saisies.every((s) => s.choix.length > 0 || s.autre.trim());
  const envoyer = async (): Promise<void> => {
    setEnvoi(true);
    const reponses = saisies.map((s) => {
      const autre = s.autre.trim();
      return autre ? { choix: s.choix, autre } : { choix: s.choix };
    });
    await repondre({ genre: 'questions', id: d.id, reponses });
    setEnvoi(false);
  };
  return (
    <>
      {d.questions.map((q, i) => (
        <BlocQuestion key={i} q={q} s={saisies[i] ?? { choix: [], autre: '' }}
          changer={(s) => setSaisies((t) => t.map((x, k) => (k === i ? s : x)))} />
      ))}
      {repondable && (
        <div className="flex justify-end">
          <Bouton ton="accent" disabled={!complet || envoi} onClick={() => void envoyer()}>Répondre</Bouton>
        </div>
      )}
    </>
  );
}

function ListeChoix({ d, repondable, repondre }: Props & { readonly d: Choix }): ReactNode {
  const [envoi, setEnvoi] = useState(false);
  const choisir = async (index: number): Promise<void> => {
    setEnvoi(true);
    await repondre({ genre: 'choix', id: d.id, index });
    setEnvoi(false);
  };
  return (
    <>
      {d.titre && <p className="whitespace-pre-wrap font-mono text-[12px] text-encre-2">{d.titre}</p>}
      <div className="flex flex-col items-start gap-1">
        {d.options.map((o, i) => (
          <Bouton key={i} disabled={!repondable || envoi} onClick={() => void choisir(i)}>
            <span className="font-mono text-discret">{i + 1}</span> {o}
          </Bouton>
        ))}
      </div>
    </>
  );
}

export function CarteDialogue(p: Props): ReactNode {
  return (
    <div className={`flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t
      border-filet bg-accent-fond px-4 py-3`}>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-accent-texte">
        <MessageCircleQuestion size={14} />
        {p.dialogue.genre === 'questions' ? 'Claude pose une question' : 'Claude attend un choix'}
        {!p.repondable && <span className="font-normal text-discret">· réponds dans le terminal</span>}
      </div>
      {p.dialogue.genre === 'questions'
        ? <FormulaireQuestions {...p} d={p.dialogue} key={p.dialogue.id} />
        : <ListeChoix {...p} d={p.dialogue} key={p.dialogue.id} />}
    </div>
  );
}
