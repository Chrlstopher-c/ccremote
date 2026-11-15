// Responsabilité : la question en attente d'un agent (question, permission, validation de plan) — ses choix en
// boutons, cases à cocher pour un choix multiple, réponse libre ; la réponse part au relais qui la transmet.
import { useState } from 'react';

import type { Dialogue } from '../../donnees';
import { useMondeBrut } from '../contexte';

export function CarteDialogue(p: { sessionId: string; dialogue: Dialogue }) {
  const { actions } = useMondeBrut();
  const d = p.dialogue;
  const [cases, setCases] = useState<number[]>([...d.coches]);
  const [libre, setLibre] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const repondre = async (r: { index?: number; cases?: number[]; texte?: string }): Promise<void> => {
    setEnvoi(true);
    await actions.repondre(p.sessionId, { id: d.id, ...r });
    setEnvoi(false);
  };
  const basculer = (i: number): void => setCases(cases.includes(i) ? cases.filter((c) => c !== i) : [...cases, i]);
  return (
    <div className="carte-dialogue">
      <div className="cd-tete">● L'agent attend ta réponse</div>
      <div className="cd-titre">{d.titre}</div>
      <div className="cd-options">
        {d.options.map((o, i) =>
          i === d.saisie ? null : (
            <button
              key={o.libelle}
              className={`cd-option ${d.multiple && cases.includes(i) ? 'coche' : ''}`}
              disabled={envoi}
              onClick={() => (d.multiple ? basculer(i) : void repondre({ index: i }))}
            >
              <kbd>{d.multiple ? (cases.includes(i) ? '☑' : '☐') : i + 1}</kbd>
              <b>{o.libelle}</b>
              {o.description ? <span>{o.description}</span> : null}
            </button>
          ),
        )}
      </div>
      {d.multiple ? (
        <button className="bouton-pixel primaire" disabled={envoi} onClick={() => void repondre({ cases })}>Valider</button>
      ) : null}
      {d.saisie !== null ? (
        <div className="cd-libre">
          <input value={libre} placeholder="Autre réponse…" onChange={(e) => setLibre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && libre.trim() && void repondre({ texte: libre })} />
          <button className="bouton-pixel" disabled={envoi || !libre.trim()} onClick={() => void repondre({ texte: libre })}>
            Répondre
          </button>
        </div>
      ) : null}
    </div>
  );
}
