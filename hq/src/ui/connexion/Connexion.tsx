// Responsabilité : l'écran de connexion d'Agent HQ (mode relais sans jeton, ou jeton refusé) — mot de passe du relais,
// jeton gardé dans ce navigateur, puis l'app redémarre sur les vraies sessions.
import { useState } from 'react';

import { CLE_JETON } from '../../donnees';
import '../theme.css';
import './connexion.css';

export function Connexion(p: { base: string; message?: string }) {
  const [mdp, setMdp] = useState('');
  const [erreur, setErreur] = useState(p.message ?? '');
  const [envoi, setEnvoi] = useState(false);
  const entrer = async (): Promise<void> => {
    setEnvoi(true);
    setErreur('');
    try {
      const r = await fetch(`${p.base}/api/connexion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motDePasse: mdp, appareil: `Agent HQ · ${navigator.userAgent.slice(0, 60)}` }),
      });
      const corps = (await r.json()) as { jeton?: string; erreur?: string };
      if (!r.ok || !corps.jeton) throw new Error(corps.erreur ?? `refus (${r.status})`);
      localStorage.setItem(CLE_JETON, corps.jeton);
      location.reload();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : String(err));
      console.error('connexion refusée', err);
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="connexion interactif">
      <form className="connexion-carte cadre-bois" onSubmit={(e) => { e.preventDefault(); void entrer(); }}>
        <h1 className="titre-pixel">Agent HQ</h1>
        <p>Le QG de tes agents Claude. Entre le mot de passe du relais.</p>
        <input type="password" autoFocus value={mdp} onChange={(e) => setMdp(e.target.value)} placeholder="Mot de passe"
          autoComplete="current-password" />
        {erreur ? <div className="connexion-erreur">{erreur}</div> : null}
        <button className="bouton-pixel primaire" disabled={envoi || !mdp}>{envoi ? '…' : 'Entrer'}</button>
      </form>
    </div>
  );
}
