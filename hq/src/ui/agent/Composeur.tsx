// Responsabilité : le champ d'envoi de l'écran d'agent — Entrée envoie, Maj+Entrée va à la ligne, état d'envoi et
// erreur visibles, le brouillon survit à la fermeture du panneau (par session).
import { useState } from 'react';

import { useMondeBrut } from '../contexte';

const brouillons = new Map<string, string>();

export function Composeur(p: { sessionId: string; actif: boolean }) {
  const { actions } = useMondeBrut();
  const [texte, setTexte] = useState(brouillons.get(p.sessionId) ?? '');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const changer = (t: string): void => {
    setTexte(t);
    brouillons.set(p.sessionId, t);
  };
  const envoyer = async (): Promise<void> => {
    if (!texte.trim() || envoi) return;
    setEnvoi(true);
    setErreur('');
    const r = await actions.envoyer(p.sessionId, texte);
    setEnvoi(false);
    if (r.ok) changer('');
    else setErreur(r.erreur);
  };
  return (
    <div className="composeur">
      {erreur ? <div className="composeur-erreur">Envoi impossible : {erreur}</div> : null}
      <div className="composeur-boite">
        <textarea
          value={texte}
          placeholder={p.actif ? 'Parle à l\'agent…' : 'Session éteinte : rallume-la pour lui parler'}
          disabled={!p.actif}
          rows={2}
          onChange={(e) => changer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void envoyer();
            }
          }}
        />
        <button className="bouton-pixel primaire" disabled={!p.actif || envoi || !texte.trim()} onClick={() => void envoyer()}>
          {envoi ? '…' : 'Envoyer'}
        </button>
      </div>
    </div>
  );
}
