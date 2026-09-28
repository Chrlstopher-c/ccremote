// Responsabilité : demander un nom ou une confirmation dans un dialogue de l'app — `prompt()` et `confirm()` du
// navigateur ne s'affichent pas de façon fiable dans la vue web de l'app de bureau.
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Bouton } from './Bouton.tsx';
import { Dialogue } from './Dialogue.tsx';
import { Champ } from './elements.tsx';

interface Demande {
  readonly titre: string;
  readonly texte?: string;
  readonly defaut?: string;
  readonly danger?: boolean;
  readonly saisie: boolean;
}

function FormulaireDemande({ demande, valeur, setValeur, clore }: {
  readonly demande: Demande | null;
  readonly valeur: string;
  readonly setValeur: (v: string) => void;
  readonly clore: (v: string | null) => void;
}): ReactNode {
  return (
    <Dialogue ouvert={demande !== null} surFermer={() => clore(null)} titre={demande?.titre ?? ''} largeur={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          clore(demande?.saisie ? valeur.trim() || null : 'oui');
        }}
      >
        {demande?.texte && <p className="mb-3 text-[13px] text-encre-2">{demande.texte}</p>}
        {demande?.saisie && (
          <Champ
            autoFocus
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            className="mb-4 w-full font-mono"
            onFocus={(e) => e.target.select()}
          />
        )}
        <div className="flex justify-end gap-2">
          <Bouton onClick={() => clore(null)}>Annuler</Bouton>
          <Bouton type="submit" ton={demande?.danger ? 'danger' : 'accent'} autoFocus={!demande?.saisie}>
            {demande?.saisie ? 'Valider' : 'Confirmer'}
          </Bouton>
        </div>
      </form>
    </Dialogue>
  );

}

export function useDemande() {
  const [demande, setDemande] = useState<Demande | null>(null);
  const [valeur, setValeur] = useState('');
  const reponse = useRef<(v: string | null) => void>(() => undefined);

  const poser = useCallback((d: Demande): Promise<string | null> => {
    setValeur(d.defaut ?? '');
    setDemande(d);
    return new Promise((ok) => (reponse.current = ok));
  }, []);

  const clore = (v: string | null): void => {
    setDemande(null);
    reponse.current(v);
  };

  const rendu: ReactNode = <FormulaireDemande demande={demande} valeur={valeur} setValeur={setValeur} clore={clore} />;

  return {
    rendu,
    nom: (titre: string, defaut = ''): Promise<string | null> => poser({ titre, defaut, saisie: true }),
    confirmer: async (titre: string, texte: string): Promise<boolean> =>
      (await poser({ titre, texte, danger: true, saisie: false })) !== null,
  };
}

export type Demandes = ReturnType<typeof useDemande>;
