// Responsabilité : l'écran de connexion au relais (adresse + mot de passe).
import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { ClientRelais, ErreurApi } from '../shared/api/client.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';
import { Champ, Libelle } from '../shared/ui/elements.tsx';
import { type Acces, normaliserBase } from './acces.ts';

export function EcranConnexion({ surConnecte, basePrecedente }: {
  readonly surConnecte: (a: Acces) => void; readonly basePrecedente: string;
}): ReactNode {
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

  return (
    <div className="grid h-full place-items-center bg-fond p-8">
      <motion.form onSubmit={(e) => void soumettre(e)} className="w-full max-w-[420px] rounded-[var(--radius-panneau)] bg-surface p-9 ombre-carte"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
        <div className="surtitre mb-3">Sessions Claude Code</div>
        <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.045em]">ccremote</h1>
        <p className="mt-2 mb-7 text-[15px] text-encre-douce">Toutes les sessions du parc, depuis un seul endroit.</p>
        <label className="mb-4 block">
          <Libelle>Adresse du relais</Libelle>
          <Champ value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="ccremote.exemple.com" required autoFocus />
        </label>
        <label className="mb-6 block">
          <Libelle>Mot de passe</Libelle>
          <Champ type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} required />
        </label>
        {erreur && <p className="mb-4 rounded-[10px] bg-danger-fond px-3 py-2 text-[13px] font-semibold text-danger">{erreur}</p>}
        <Bouton type="submit" variante="plein" disabled={envoi} className="w-full" icone={<ArrowRight size={17} />}>
          {envoi ? 'Connexion…' : 'Se connecter'}
        </Bouton>
        <p className="mt-7 flex items-center justify-center gap-2 text-[12px] text-discret">
          un outil <img src="/wordmark.svg" alt="Echo Agency" className="h-4 opacity-70 dark:invert" />
        </p>
      </motion.form>
    </div>
  );
}
