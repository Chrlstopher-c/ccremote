// Responsabilité : une session choisie — barre d'outils (actions), ligne d'état (contexte), fil, compositeur.
import { Minimize2, Play, Power, Square, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ResumeSession } from '../../../commun/session.ts';
import { tokens } from '../shared/format.ts';
import { estBureau } from '../shared/natif.ts';
import { IconeBouton } from '../shared/ui/Bouton.tsx';
import { Bascule, Jauge, Point } from '../shared/ui/elements.tsx';
import { Composeur } from './Composeur.tsx';
import { LectureSeule, useLectureSeule } from './LectureSeule.tsx';
import { Fil } from './fil/Fil.tsx';
import { STATUTS } from './statut.ts';
import { useActionsSession } from './useActionsSession.ts';

type Actions = ReturnType<typeof useActionsSession>;
const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;

function BarreOutils({ s, a }: { readonly s: ResumeSession; readonly a: Actions }): ReactNode {
  const ouverte = s.tmux !== null;
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-filet px-3">
      <div className="min-w-0 flex-1 pr-3">
        <h1 className="truncate text-[13.5px] font-bold">{s.titre}</h1>
      </div>
      {ouverte && estBureau() && (
        <IconeBouton aide="Ouvrir le terminal" raccourci="Ctrl+T" onClick={() => void a.terminal()}>
          <SquareTerminal size={15} />
        </IconeBouton>
      )}
      {ouverte && (
        <IconeBouton aide="Interrompre" onClick={() => void a.agir('interrompre')}><Square size={13} /></IconeBouton>
      )}
      {ouverte && (
        <IconeBouton aide="Compacter" onClick={() => void a.agir('compacter')}><Minimize2 size={14} /></IconeBouton>
      )}
      {ouverte && (
        <IconeBouton aide="Fermer la session" ton="danger" onClick={() => void a.agir('fermer')}>
          <Power size={14} />
        </IconeBouton>
      )}
      {!ouverte && !s.terminal && (
        <IconeBouton aide="Reprendre" disabled={!s.claudeSessionId} onClick={() => void a.agir('reprendre')}>
          <Play size={14} />
        </IconeBouton>
      )}
      {s.terminal && <span className="font-mono text-[10.5px] text-discret">terminal · lecture seule</span>}
    </header>
  );
}

// La jauge vire au rouge au seuil de compaction dure (35 % d'une fenêtre de 1 M) : au-delà, chaque tour coûte cher.
function LigneEtat({ s, a }: { readonly s: ResumeSession; readonly a: Actions }): ReactNode {
  const st = STATUTS[s.statut];
  const ratio = s.contexte.max > 0 ? s.contexte.tokens / s.contexte.max : 0;
  return (
    <div className={`flex h-8 shrink-0 items-center gap-3 border-b
      border-filet bg-liste px-4 font-mono text-[11px] text-discret`}>
      <span className="flex items-center gap-1.5 text-encre-2"><Point ton={st.ton} />{st.libelle.toLowerCase()}</span>
      <span>{`${s.machine} · ${s.projet.nom}`}</span>
      <span>{s.modele}</span>
      <span className="flex items-center gap-1.5">
        <Jauge valeur={ratio} alerte={0.35} largeur="w-16" />
        {`${tokens(s.contexte.tokens)} / ${tokens(s.contexte.max)}`}
      </span>
      <span>{`${pluriel(s.etapes, 'étape')} · ${pluriel(s.compactions, 'compaction')}`}</span>
      <span className="flex-1" />
      {s.pilotee && (
        <label className="flex items-center gap-1.5">
          autonomie <Bascule active={s.autonomie} onChange={(v) => void a.autonomie(v)} libelle="Autonomie" />
        </label>
      )}
    </div>
  );
}

export function VueSession({ session }: { readonly session: ResumeSession }): ReactNode {
  const actions = useActionsSession(session);
  const lectureSeule = useLectureSeule(session);
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-fond">
      <BarreOutils s={session} a={actions} />
      <LigneEtat s={session} a={actions} />
      {actions.erreur && (
        <button type="button" onClick={actions.effacerErreur}
          className="cursor-default border-b border-filet px-4 py-1.5 text-left text-[12px] text-danger">
          {actions.erreur}
        </button>
      )}
      <Fil sessionId={session.id} dossier={session.cwd} />
      {lectureSeule ? <LectureSeule s={session} raison={lectureSeule} />
        : <Composeur session={session} envoyer={actions.envoyer} occupe={actions.occupe} />}
    </section>
  );
}
