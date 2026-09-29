// Responsabilité : le bandeau « sens injoignables » — Echo ne rallume plus la tour d'office, Chris décide ici.
import { Power } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { DecisionReveil, ReveilEcho } from '../../../commun/echo.ts';
import { useMagasin } from '../shared/etat/contexte.tsx';
import { depuis } from '../shared/format.ts';
import { journal } from '../shared/journal.ts';
import { Bouton } from '../shared/ui/Bouton.tsx';

function useReveilEcho() {
  const magasin = useMagasin();
  const [reveil, setReveil] = useState<ReveilEcho | null>(null);
  useEffect(() => {
    magasin.client.echoEtat().then(
      (e) => setReveil(e.reveil ?? null),
      (erreur: unknown) => journal.warn({ erreur: String(erreur) }, 'réveil en attente illisible'),
    );
    return magasin.ecouterEcho((m) => {
      if (m.type === 'reveil') setReveil(m.attente);
    });
  }, [magasin]);
  const decider = useCallback(
    (action: DecisionReveil): void => {
      if (action === 'ignorer') setReveil(null);
      magasin.client.echoReveil(action).catch((erreur: unknown) => {
        journal.warn({ erreur: String(erreur) }, 'décision de réveil non transmise');
      });
    },
    [magasin],
  );
  return { reveil, decider };
}

export function BandeauReveil(): ReactNode {
  const { reveil, decider } = useReveilEcho();
  if (!reveil) return null;
  const enCours = reveil.statut === 'en_cours';
  return (
    <div className="flex items-center gap-3 border-b border-filet bg-accent-fond px-5 py-2.5 text-[12.5px]">
      <Power size={14} className="text-alerte" />
      <span className="flex-1">
        {enCours
          ? `Réveil de « ${reveil.machine} » demandé, en attente de son retour…`
          : `Echo n’atteint plus ses sens : « ${reveil.machine} » est éteinte (${depuis(reveil.depuis)}).`}
      </span>
      {!enCours && (
        <>
          <Bouton onClick={() => decider('ignorer')}>Laisser éteinte</Bouton>
          <Bouton ton="accent" onClick={() => decider('reveiller')}>Réveiller</Bouton>
        </>
      )}
    </div>
  );
}
