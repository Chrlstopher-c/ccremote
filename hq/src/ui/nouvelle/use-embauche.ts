// Responsabilité : l'état du formulaire d'embauche (machine, projet, titre, premier message, modèle) et son envoi —
// relais réel ou démo selon la source du monde ; à la réussite, ferme et ouvre l'écran de la nouvelle session.
import { useMemo, useState } from 'react';

import { lireConfig, type Projet, type VueMachine } from '../../donnees';
import { configRelais } from '../config-relais';
import { journaliser } from '../../donnees';
import { creerOuverture, MODELE_PAR_DEFAUT, type ServiceOuverture } from '../../donnees';
import { fermer, ouvrir } from '../bus';
import { useMonde, useMondeBrut } from '../contexte';

export interface Formulaire {
  readonly machine: string;
  readonly projet: Projet | null;
  readonly titre: string;
  readonly message: string;
  readonly modele: string;
  readonly autonomie: boolean;
}

const VIDE: Formulaire = { machine: '', projet: null, titre: '', message: '', modele: MODELE_PAR_DEFAUT, autonomie: false };

function useService(): ServiceOuverture {
  const { source, magasin } = useMondeBrut();
  return useMemo(() => {
    const config = source.nom === 'demo' ? lireConfig({}, null) : configRelais();
    return creerOuverture(config, magasin);
  }, [source, magasin]);
}

/** Machines en ligne d'abord ; la première en ligne est choisie par défaut. */
export function useMachines(): readonly VueMachine[] {
  const machines = useMonde((e) => e.machines);
  return useMemo(() => [...machines].sort((a, b) => Number(b.enLigne) - Number(a.enLigne)), [machines]);
}

export interface Embauche {
  readonly f: Formulaire;
  readonly machine: string;
  readonly machines: readonly VueMachine[];
  readonly pret: boolean;
  readonly envoi: boolean;
  readonly erreur: string;
  changer(partiel: Partial<Formulaire>): void;
  choisirMachine(id: string): void;
  embaucher(): Promise<void>;
}

export function useEmbauche(): Embauche {
  const service = useService();
  const machines = useMachines();
  const [f, setF] = useState<Formulaire>(VIDE);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const machine = f.machine || machines.find((m) => m.enLigne)?.id || '';
  const changer = (partiel: Partial<Formulaire>): void => setF((x) => ({ ...x, ...partiel }));
  const choisirMachine = (id: string): void => changer({ machine: id, projet: null });
  const pret = machine !== '' && f.projet !== null && f.message.trim() !== '' && !envoi;
  const embaucher = async (): Promise<void> => {
    if (!pret || !f.projet) return;
    setEnvoi(true);
    setErreur('');
    const r = await service.ouvrir({ machine, projet: f.projet, message: f.message, titre: f.titre, modele: f.modele,
      autonomie: f.autonomie });
    setEnvoi(false);
    if (!r.ok) {
      setErreur(r.erreur);
      return;
    }
    journaliser('info', 'agent embauché', { sessionId: r.sessionId, machine });
    if (r.sessionId) ouvrir({ type: 'agent', sessionId: r.sessionId });
    else fermer();
  };
  return { f, machine, machines, changer, choisirMachine, pret, envoi, erreur, embaucher };
}
