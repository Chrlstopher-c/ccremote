// Responsabilité : la conversation avec Echo — historique (source de vérité côté Echo), réponse en cours au fil du
// flux, envoi et interruption.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import type { EntreeHistoriqueEcho, MessageEcho } from '../../../commun/echo.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useMagasin } from '../shared/etat/contexte.tsx';
import { journal } from '../shared/journal.ts';

export type Disponibilite = 'chargement' | 'ok' | 'injoignable' | 'absente';

export interface EnCours {
  readonly texte: string;
  readonly outils: readonly string[];
}

const VIDE: EnCours = { texte: '', outils: [] };

function disponibiliteDe(erreur: unknown): Disponibilite {
  return erreur instanceof ErreurApi && erreur.statut === 404 ? 'absente' : 'injoignable';
}

export function useEcho() {
  const magasin = useMagasin();
  const [historique, setHistorique] = useState<readonly EntreeHistoriqueEcho[]>([]);
  const [enCours, setEnCours] = useState<EnCours>(VIDE);
  const [occupe, setOccupe] = useState(false);
  const [dispo, setDispo] = useState<Disponibilite>('chargement');

  const relire = useCallback(async (): Promise<void> => {
    try {
      const [etat, h] = await Promise.all([magasin.client.echoEtat(), magasin.client.echoHistorique()]);
      setOccupe(etat.occupe);
      setHistorique(h);
      setDispo(etat.joignable ? 'ok' : 'injoignable');
    } catch (erreur) {
      journal.warn({ erreur: String(erreur) }, 'Echo non chargée');
      setDispo(disponibiliteDe(erreur));
    }
  }, [magasin]);

  useEffect(() => {
    void relire();
    return magasin.ecouterEcho((m: MessageEcho) => {
      if (m.type === 'delta') setEnCours((e) => ({ ...e, texte: e.texte + m.texte }));
      else if (m.type === 'outil') setEnCours((e) => ({ ...e, outils: [...e.outils, m.nom] }));
      else if (m.type === 'etat') setOccupe(m.occupe);
      else if (m.type === 'fin') {
        setEnCours(VIDE);
        void relire();
      }
    });
  }, [magasin, relire]);

  const { envoyer, interrompre } = useActionsEcho(setHistorique, setDispo);
  return { historique, enCours, occupe, dispo, envoyer, interrompre };
}

function useActionsEcho(
  setHistorique: Dispatch<SetStateAction<readonly EntreeHistoriqueEcho[]>>,
  setDispo: (d: Disponibilite) => void,
) {
  const magasin = useMagasin();
  const envoyer = useCallback(
    async (texte: string): Promise<boolean> => {
      const ts = new Date().toISOString();
      setHistorique((h) => [...h, { ts, qui: 'chris', origine: 'quart:app', texte }]);
      try {
        await magasin.client.echoParler(texte);
        return true;
      } catch (erreur) {
        journal.warn({ erreur: String(erreur) }, 'message à Echo non envoyé');
        setDispo(disponibiliteDe(erreur));
        return false;
      }
    },
    [magasin],
  );

  const interrompre = useCallback(async (): Promise<void> => {
    try {
      await magasin.client.echoInterrompre();
    } catch (erreur) {
      journal.warn({ erreur: String(erreur) }, 'interruption d’Echo refusée');
    }
  }, [magasin]);

  return { envoyer, interrompre };
}
