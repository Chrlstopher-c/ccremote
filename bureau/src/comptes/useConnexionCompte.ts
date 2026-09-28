// Responsabilité : ajouter un compte Claude Code à une machine — lancer la connexion (la page s'ouvre dans le
// navigateur), puis transmettre le code que la page rend. Deux temps, une erreur lisible à chaque étape.
import { useState } from 'react';
import { type ClientRelais, ErreurApi } from '../shared/api/client.ts';
import { useMagasin } from '../shared/etat/contexte.tsx';
import { ouvrirLien } from '../shared/natif.ts';

export type Etape =
  | { readonly nom: 'formulaire' }
  | { readonly nom: 'code'; readonly machine: string; readonly compte: string; readonly url: string }
  | { readonly nom: 'fini'; readonly compte: string; readonly machine: string };

interface Contexte {
  readonly client: ClientRelais;
  readonly etape: Etape;
  readonly setEtape: (e: Etape) => void;
  readonly setErreur: (e: string | null) => void;
}

async function demarrer(c: Contexte, machine: string, compte: string, email?: string): Promise<void> {
  const { url } = await c.client.connecterCompte(machine, compte, email);
  c.setEtape({ nom: 'code', machine, compte, url });
  const refus = await ouvrirLien(url);
  if (refus) c.setErreur(`page non ouverte (${refus}) : ouvre le lien à la main`);
}

async function valider(c: Contexte, code: string): Promise<void> {
  if (c.etape.nom !== 'code') return;
  await c.client.validerCompte(c.etape.machine, c.etape.compte, code);
  c.setEtape({ nom: 'fini', compte: c.etape.compte, machine: c.etape.machine });
}

async function abandonner(c: Contexte): Promise<void> {
  if (c.etape.nom === 'code') await c.client.retirerCompte(c.etape.machine, c.etape.compte);
  c.setEtape({ nom: 'formulaire' });
}

export function useConnexionCompte() {
  const { client } = useMagasin();
  const [etape, setEtape] = useState<Etape>({ nom: 'formulaire' });
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const c: Contexte = { client, etape, setEtape, setErreur };
  const executer = async (f: () => Promise<void>): Promise<void> => {
    setOccupe(true);
    setErreur(null);
    try {
      await f();
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };
  return {
    etape,
    erreur,
    occupe,
    reprendre: (machine: string, compte: string, url: string) => setEtape({ nom: 'code', machine, compte, url }),
    demarrer: (machine: string, compte: string, email?: string) => executer(() => demarrer(c, machine, compte, email)),
    valider: (code: string) => executer(() => valider(c, code)),
    abandonner: () => executer(() => abandonner(c)),
    reinitialiser: () => {
      setEtape({ nom: 'formulaire' });
      setErreur(null);
    },
  };
}
