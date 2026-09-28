// Responsabilité : une session ouverte — en-tête (état, contexte, actions), fil, compositeur.
import { Minimize2, Play, Power, Square, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';
import { tokens } from '../shared/format.ts';
import { estBureau } from '../shared/natif.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Bascule, Jauge, Point, Tag } from '../shared/ui/elements.tsx';
import { Composeur } from './Composeur.tsx';
import { Fil } from './fil/Fil.tsx';
import { STATUTS } from './statut.ts';
import { useActionsSession } from './useActionsSession.ts';

type Actions = ReturnType<typeof useActionsSession>;
const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;

function Identite({ s }: { readonly s: ResumeSession }): ReactNode {
  const st = STATUTS[s.statut];
  const tonTag = st.ton === 'alerte' ? 'alerte' : st.ton === 'eteint' ? 'neutre' : 'accent';
  return (
    <div className="min-w-0 flex-1">
      <div className="surtitre mb-1.5">{`${s.machine} · ${s.projet.nom}`}</div>
      <h1 className="truncate text-[24px] leading-tight font-extrabold tracking-[-0.035em]">{s.titre}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Tag ton={tonTag}><Point ton={st.ton} />{st.libelle}</Tag>
        <Tag ton="neutre">{s.pilotee ? 'pilotée' : 'adoptée'}</Tag>
        {s.attachee && <Tag ton="neutre">terminal attaché</Tag>}
        <span className="font-mono text-[11.5px] text-discret">
          {`${s.modele} · ${pluriel(s.etapes, 'étape')} · ${pluriel(s.compactions, 'compaction')}`}
        </span>
      </div>
    </div>
  );
}

// La jauge vire au rouge au seuil de compaction dure (35 % d'une fenêtre de 1 M) : au-delà, chaque tour coûte cher.
function Contexte({ s, actions }: { readonly s: ResumeSession; readonly actions: Actions }): ReactNode {
  const ratio = s.contexte.max > 0 ? s.contexte.tokens / s.contexte.max : 0;
  return (
    <div className="w-56 shrink-0 pt-1">
      <div className="mb-1.5 flex justify-between font-mono text-[11px] text-discret">
        <span>contexte</span>
        <span>{`${tokens(s.contexte.tokens)} / ${tokens(s.contexte.max)}`}</span>
      </div>
      <Jauge valeur={ratio} alerte={0.35} />
      {s.pilotee && (
        <label className="mt-3 flex items-center justify-between text-[13px] font-bold text-encre-douce">
          Autonomie
          <Bascule active={s.autonomie} onChange={(v) => void actions.autonomie(v)} libelle="Autonomie" />
        </label>
      )}
    </div>
  );
}

function BarreActions({ s, actions }: { readonly s: ResumeSession; readonly actions: Actions }): ReactNode {
  if (s.tmux === null) {
    return (
      <div className="mt-4 flex justify-end">
        <Bouton compact variante="plein" icone={<Play size={14} />} disabled={!s.claudeSessionId}
          onClick={() => void actions.agir('reprendre')}>Reprendre</Bouton>
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {estBureau() && (
        <Bouton compact icone={<SquareTerminal size={15} />} onClick={() => void actions.terminal()}>
          Ouvrir le terminal
        </Bouton>
      )}
      <Bouton compact variante="discret" icone={<Square size={14} />} onClick={() => void actions.agir('interrompre')}>
        Interrompre
      </Bouton>
      <Bouton compact variante="discret" icone={<Minimize2 size={14} />} onClick={() => void actions.agir('compacter')}>
        Compacter
      </Bouton>
      <span className="flex-1" />
      <Bouton compact variante="danger" icone={<Power size={14} />} onClick={() => void actions.agir('fermer')}>
        Fermer
      </Bouton>
    </div>
  );
}

export function VueSession({ session }: { readonly session: ResumeSession }): ReactNode {
  const actions = useActionsSession(session);
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-fond">
      <header className="border-b border-filet bg-surface px-8 py-5">
        <div className="flex items-start gap-6">
          <Identite s={session} />
          <Contexte s={session} actions={actions} />
        </div>
        <BarreActions s={session} actions={actions} />
      </header>
      {actions.erreur && (
        <button type="button" onClick={actions.effacerErreur}
          className="bg-danger-fond px-8 py-2 text-left text-[13px] font-semibold text-danger">{actions.erreur}</button>
      )}
      <Fil sessionId={session.id} dossier={session.cwd} />
      <Composeur session={session} envoyer={actions.envoyer} occupe={actions.occupe} />
    </section>
  );
}
