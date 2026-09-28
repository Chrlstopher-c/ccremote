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

function EnTete({ s, actions }: { readonly s: ResumeSession; readonly actions: ReturnType<typeof useActionsSession> }): ReactNode {
  const st = STATUTS[s.statut];
  const ratio = s.contexte.max > 0 ? s.contexte.tokens / s.contexte.max : 0;
  return (
    <header className="border-b border-filet bg-surface px-8 py-5">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="surtitre mb-1.5">{s.machine} · {s.projet.nom}</div>
          <h1 className="truncate text-[24px] leading-tight font-extrabold tracking-[-0.035em]">{s.titre}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag ton={st.ton === 'alerte' ? 'alerte' : st.ton === 'eteint' ? 'neutre' : 'accent'}><Point ton={st.ton} />{st.libelle}</Tag>
            {s.pilotee ? <Tag ton="neutre">pilotée</Tag> : <Tag ton="neutre">adoptée</Tag>}
            {s.attachee && <Tag ton="neutre">terminal attaché</Tag>}
            <span className="font-mono text-[11.5px] text-discret">{s.modele} · {s.etapes} étape{s.etapes > 1 ? 's' : ''} · {s.compactions} compaction{s.compactions > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="w-56 shrink-0 pt-1">
          <div className="mb-1.5 flex justify-between font-mono text-[11px] text-discret">
            <span>contexte</span><span>{tokens(s.contexte.tokens)} / {tokens(s.contexte.max)}</span>
          </div>
          <Jauge valeur={ratio} alerte={0.35} />
          {s.pilotee && (
            <label className="mt-3 flex items-center justify-between text-[13px] font-bold text-encre-douce">
              Autonomie <Bascule active={s.autonomie} onChange={(v) => void actions.autonomie(v)} libelle="Autonomie" />
            </label>
          )}
        </div>
      </div>
      <BarreActions s={s} actions={actions} />
    </header>
  );
}

function BarreActions({ s, actions }: { readonly s: ResumeSession; readonly actions: ReturnType<typeof useActionsSession> }): ReactNode {
  const ouverte = s.tmux !== null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {ouverte && estBureau() && <Bouton compact icone={<SquareTerminal size={15} />} onClick={() => void actions.terminal()}>Ouvrir le terminal</Bouton>}
      {ouverte && <Bouton compact variante="discret" icone={<Square size={14} />} onClick={() => void actions.agir('interrompre')}>Interrompre</Bouton>}
      {ouverte && <Bouton compact variante="discret" icone={<Minimize2 size={14} />} onClick={() => void actions.agir('compacter')}>Compacter</Bouton>}
      <span className="flex-1" />
      {ouverte
        ? <Bouton compact variante="danger" icone={<Power size={14} />} onClick={() => void actions.agir('fermer')}>Fermer</Bouton>
        : <Bouton compact variante="plein" icone={<Play size={14} />} disabled={!s.claudeSessionId} onClick={() => void actions.agir('reprendre')}>Reprendre</Bouton>}
    </div>
  );
}

export function VueSession({ session }: { readonly session: ResumeSession }): ReactNode {
  const actions = useActionsSession(session);
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-fond">
      <EnTete s={session} actions={actions} />
      {actions.erreur && (
        <button type="button" onClick={actions.effacerErreur} className="bg-danger-fond px-8 py-2 text-left text-[13px] font-semibold text-danger">
          {actions.erreur}
        </button>
      )}
      <Fil sessionId={session.id} dossier={session.cwd} />
      <Composeur session={session} envoyer={actions.envoyer} occupe={actions.occupe} />
    </section>
  );
}
