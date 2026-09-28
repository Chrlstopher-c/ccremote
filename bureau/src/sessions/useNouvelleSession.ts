// Responsabilité : l'état du formulaire d'ouverture — machine, projet joignable depuis elle, envoi au relais.
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { Projet } from '../../../commun/session.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useEtat, useMagasin } from '../shared/etat/contexte.tsx';

const ISOLEE = 'vps'; // règle du parc : le VPS ne travaille que sur ses propres projets
const VIERGE = { titre: '', objectif: '', message: '', modele: '', compte: '', autonomie: true };
export type Formulaire = typeof VIERGE;

const cle = (p: Projet): string => `${p.machine}:${p.chemin}`;

// Machine choisie + projet joignable depuis elle (le VPS isolé ne voit que ses propres projets).
function useEmplacement(ouvert: boolean, machineInitiale?: string) {
  const machines = useEtat((e) => e.machines);
  const enLigne = useMemo(() => machines.filter((m) => m.enLigne), [machines]);
  const [machine, setMachine] = useState('');
  const [cleProjet, setCleProjet] = useState('');
  useEffect(() => {
    if (ouvert && !enLigne.some((m) => m.id === machine)) setMachine(enLigne[0]?.id ?? '');
  }, [ouvert, enLigne, machine]);
  // Ouverte depuis un appareil : la session part sur lui, sauf s'il est hors ligne.
  useEffect(() => {
    if (ouvert && machineInitiale && enLigne.some((m) => m.id === machineInitiale)) setMachine(machineInitiale);
  }, [ouvert, machineInitiale]); // eslint-disable-line react-hooks/exhaustive-deps -- à l'ouverture seulement
  const projets = useMemo(
    () => machines.filter((m) => machine !== ISOLEE || m.id === ISOLEE).map((m) => [m.id, m.projets] as const),
    [machines, machine],
  );
  const projet = projets.flatMap(([, p]) => p).find((p) => cle(p) === cleProjet);
  useEffect(() => {
    const premier = projets.find(([id]) => id === machine)?.[1][0];
    if (!projet && premier) setCleProjet(cle(premier));
  }, [projets, machine, projet]);
  const choisirMachine = (id: string): void => {
    setMachine(id);
    setCleProjet('');
  };
  // Les comptes connectés de la machine choisie, avec leur usage de la fenêtre de 5 h pour choisir en connaissance.
  const comptes = useMemo(
    () => (machines.find((m) => m.id === machine)?.etatComptes ?? []).filter((c) => c.connecte),
    [machines, machine],
  );
  return { enLigne, machine, choisirMachine, projets, projet, cleProjet, setCleProjet, cle, comptes };
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
