// Responsabilité : la liste des accès au relais et ce qu'on en fait — recharger, créer un connecteur, révoquer.
import { useCallback, useEffect, useState } from 'react';
import type { DemandeAcces, NouvelAcces, VueAcces } from '../../../commun/api-clients.ts';
import { type ClientRelais, ErreurApi } from '../shared/api/client.ts';
import { useMagasin } from '../shared/etat/contexte.tsx';
import { journal } from '../shared/journal.ts';

export function useAcces() {
  const { client } = useMagasin();
  const [liste, setListe] = useState<VueAcces[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const attraper = useCallback((e: unknown): void => {
    journal.warn({ erreur: String(e) }, 'accès : échec');
    setErreur(e instanceof ErreurApi ? e.message : String(e));
  }, []);
  const recharger = useCallback(async (): Promise<void> => {
    try {
      setListe(await client.acces());
    } catch (e) {
      attraper(e);
    }
  }, [client, attraper]);
  useEffect(() => void recharger(), [recharger]);
  return {
    liste,
    erreur,
    recharger,
    base: client.base || window.location.origin,
    effacer: () => setErreur(null),
    ...actions(client, recharger, attraper),
  };
}

function actions(client: ClientRelais, recharger: () => Promise<void>, attraper: (e: unknown) => void) {
  return {
    creer: async (d: DemandeAcces): Promise<NouvelAcces | null> => {
      try {
        const n = await client.creerAcces(d);
        await recharger();
        return n;
      } catch (e) {
        attraper(e);
        return null;
      }
    },
    revoquer: async (id: string): Promise<void> => {
      try {
        await client.revoquerAcces(id);
        await recharger();
      } catch (e) {
        attraper(e);
      }
    },
  };
}
