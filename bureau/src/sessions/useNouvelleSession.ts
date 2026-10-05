// Responsabilité : l'état du formulaire d'ouverture — machine, un de ses projets ou un emplacement, envoi au relais.
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { Projet } from '../../../commun/session.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';

const VIERGE = { titre: '', objectif: '', message: '', modele: '', compte: '', autonomie: true };
export type Formulaire = typeof VIERGE;

const cle = (p: Projet): string => `${p.machine}:${p.chemin}`;

export const AUCUN_PROJET = '';
const MAISON = '~';

/** Un emplacement libre (pas un projet découvert) : son nom est son dernier dossier, « maison » pour ~. */
export function projetLibre(machine: string, emplacement: string): Projet {
  const chemin = emplacement.trim() || MAISON;
  const nom = chemin === MAISON ? 'maison' : (chemin.replace(/\/+$/, '').split('/').pop() ?? chemin) || chemin;
  return { machine, chemin, nom };
}

// La machine choisie : la première en ligne, ou celle d'où le formulaire a été ouvert.
function useMachineChoisie(ouvert: boolean, machineInitiale?: string) {
  const machines = useEtat((e) => e.machines);
  const enLigne = useMemo(() => machines.filter((m) => m.enLigne), [machines]);
  const [machine, setMachine] = useState('');
  useEffect(() => {
    if (ouvert && !enLigne.some((m) => m.id === machine)) setMachine(enLigne[0]?.id ?? '');
  }, [ouvert, enLigne, machine]);
  // Ouverte depuis un appareil : la session part sur lui, sauf s'il est hors ligne.
  useEffect(() => {
    if (ouvert && machineInitiale && enLigne.some((m) => m.id === machineInitiale)) setMachine(machineInitiale);
  }, [ouvert, machineInitiale]); // eslint-disable-line react-hooks/exhaustive-deps -- à l'ouverture seulement
  return { machines, enLigne, machine, setMachine };
}

// Machine choisie, puis un de SES projets — ou aucun projet et un emplacement libre (par défaut le dossier personnel).
function useEmplacement(ouvert: boolean, machineInitiale?: string) {
  const { machines, enLigne, machine, setMachine } = useMachineChoisie(ouvert, machineInitiale);
  const [cleProjet, setCleProjet] = useState(AUCUN_PROJET);
  const [emplacement, setEmplacement] = useState(MAISON);
  const projets = useMemo(() => machines.find((m) => m.id === machine)?.projets ?? [], [machines, machine]);
  const projet =
    cleProjet === AUCUN_PROJET
      ? machine
        ? projetLibre(machine, emplacement)
        : undefined
      : projets.find((p) => cle(p) === cleProjet);
  const choisirMachine = (id: string): void => {
    setMachine(id);
    setCleProjet(AUCUN_PROJET);
  };
  // Les comptes connectés de la machine choisie, avec leur usage de la fenêtre de 5 h pour choisir en connaissance.
  const comptes = useMemo(
    () => (machines.find((m) => m.id === machine)?.etatComptes ?? []).filter((c) => c.connecte),
    [machines, machine],
  );
  return {
    enLigne,
    machine,
    choisirMachine,
    projets,
    projet,
    cleProjet,
    setCleProjet,
    cle,
    comptes,
    emplacement,
    setEmplacement,
  };
}

export function useNouvelleSession(ouvert: boolean, surOuverte: (id: string) => void, machineInitiale?: string) {
  const { client } = useMagasin();
  const lieu = useEmplacement(ouvert, machineInitiale);
  const [f, setF] = useState<Formulaire>(VIERGE);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!lieu.projet) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const s = await client.ouvrir({
        machine: lieu.machine,
        projet: lieu.projet,
        message: f.message,
        titre: f.titre || undefined,
        objectif: f.objectif.trim() || null,
        autonomie: f.autonomie,
        ...(f.modele ? { modele: f.modele } : {}),
        ...(f.compte && lieu.comptes.some((c) => c.id === f.compte) ? { compte: f.compte } : {}),
      });
      setF(VIERGE);
      surOuverte(s.id);
    } catch (err) {
      setErreur(err instanceof ErreurApi ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  return { ...lieu, f, setF, erreur, envoi, soumettre };
}
