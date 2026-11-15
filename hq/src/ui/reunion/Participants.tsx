// Responsabilité : la colonne des participants de la salle de réunion — sessions actives à cocher, avec la pastille
// de leur état, et le mode « Auto » où le relais choisit qui est concerné.
import { useMemo } from 'react';

import { etatAgent, type ResumeSession } from '../../donnees';
import { useMonde } from '../contexte';

export function useSessionsDeReunion(): readonly ResumeSession[] {
  const sessions = useMonde((e) => e.sessions);
  return useMemo(() => sessions.filter((s) => !s.archivee && s.statut !== 'fermee'), [sessions]);
}

function LigneSession(p: { s: ResumeSession; coche: boolean; inactif: boolean; basculer: () => void }) {
  const etat = etatAgent(p.s, Date.now());
  return (
    <li>
      <label className={`salle-session ${p.coche && !p.inactif ? 'cochee' : ''} ${p.inactif ? 'inactif' : ''}`}>
        <input type="checkbox" checked={p.coche} disabled={p.inactif} onChange={p.basculer} />
        <span className={`salle-pastille ${etat}`} title={etat} />
        <span className="salle-session-textes">
          <span className="salle-session-titre">{p.s.titre}</span>
          <span className="salle-session-lieu">{p.s.projet.nom} · {p.s.machine}</span>
        </span>
      </label>
    </li>
  );
}

interface Props {
  choisis: readonly string[];
  auto: boolean;
  basculer: (id: string) => void;
  definirAuto: (auto: boolean) => void;
}

export function Participants(p: Props) {
  const sessions = useSessionsDeReunion();
  return (
    <aside className="salle-participants">
      <h3 className="titre-pixel salle-titre-col">Autour de la table</h3>
      <label className={`salle-auto ${p.auto ? 'actif' : ''}`}>
        <input type="checkbox" checked={p.auto} onChange={(e) => p.definirAuto(e.target.checked)} />
        <span>
          <strong>Auto</strong>
          <small>Le relais choisit les agents concernés</small>
        </span>
      </label>
      <ul className="salle-sessions">
        {sessions.map((s) => (
          <LigneSession key={s.id} s={s} coche={p.choisis.includes(s.id)} inactif={p.auto}
            basculer={() => p.basculer(s.id)} />
        ))}
        {sessions.length === 0 ? <li className="salle-vide-petit">Aucune session active.</li> : null}
      </ul>
    </aside>
  );
}
