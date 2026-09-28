// Responsabilité : l'écran de connexion au relais (adresse + mot de passe) — un petit panneau, comme une app.
import { type FormEvent, type ReactNode, useState } from 'react';
import { ClientRelais, ErreurApi } from '../shared/api/client.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Champ, Libelle } from '../shared/ui/elements.tsx';
import { type Acces, normaliserBase } from './acces.ts';

function useConnexion(basePrecedente: string, surConnecte: (a: Acces) => void) {
  const [adresse, setAdresse] = useState(basePrecedente);
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const base = normaliserBase(adresse);
    try {
      surConnecte({ base, jeton: await ClientRelais.connecter(base, motDePasse) });
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : 'Relais injoignable à cette adresse.');
    } finally {
      setEnvoi(false);
    }
  }

  return { adresse, setAdresse, motDePasse, setMotDePasse, erreur, envoi, soumettre };
}

export function EcranConnexion({ surConnecte, basePrecedente }: {
  readonly surConnecte: (a: Acces) => void;
  readonly basePrecedente: string;
}): ReactNode {
  const c = useConnexion(basePrecedente, surConnecte);
  return (
    <div className="grid h-full place-items-center bg-cote">
      <form onSubmit={(e) => void c.soumettre(e)}
        className="w-[340px] rounded-[10px] bg-fond p-6 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.3)] ring-1 ring-filet">
        <h1 className="text-[18px] font-extrabold tracking-[-0.03em]">ccremote</h1>
        <p className="mb-5 text-[12.5px] text-discret">Se connecter au relais du parc.</p>
        <label className="mb-3 block">
          <Libelle>Adresse du relais</Libelle>
          <Champ value={c.adresse} onChange={(e) => c.setAdresse(e.target.value)} placeholder="ccremote.exemple.com"
            required autoFocus />
        </label>
        <label className="mb-4 block">
          <Libelle>Mot de passe</Libelle>
          <Champ type="password" value={c.motDePasse} onChange={(e) => c.setMotDePasse(e.target.value)} required />
        </label>
        {c.erreur && <p className="mb-3 text-[12px] text-danger">{c.erreur}</p>}
        <Bouton type="submit" ton="accent" disabled={c.envoi} className="w-full justify-center">
          {c.envoi ? 'Connexion…' : 'Se connecter'}
        </Bouton>
        <p className="mt-5 text-center font-mono text-[10.5px] text-discret">un outil Echo Agency</p>
      </form>
    </div>
  );
}
