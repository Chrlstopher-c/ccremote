// Responsabilité : l'état de l'explorateur d'un appareil — dossier courant, contenu, fichier ouvert, et les gestes
// (entrer, remonter, créer, déposer, renommer, supprimer) avec leur message de retour.
import { useCallback, useEffect, useState } from 'react';
import type { EntreeFichier, ListeDossier } from '../../../../commun/appareil.ts';
import { ErreurApi } from '../../shared/api/client.ts';
import { type ApiAppareil, joindre } from '../api-appareil.ts';

export interface FichierOuvert {
  readonly chemin: string;
  readonly entree: EntreeFichier;
}

function trier(entrees: readonly EntreeFichier[], caches: boolean): EntreeFichier[] {
  return entrees
    .filter((e) => caches || !e.cache)
    .toSorted(
      (a, b) => Number(b.type === 'dossier') - Number(a.type === 'dossier') || a.nom.localeCompare(b.nom, 'fr'),
    );
}

function useDossier(api: ApiAppareil) {
  const [liste, setListe] = useState<ListeDossier | null>(null);
  const [chemin, setChemin] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const recharger = useCallback(async (): Promise<void> => {
    setCharge(true);
    try {
      setListe(await api.lister(chemin));
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof ErreurApi ? e.message : String(e));
    } finally {
      setCharge(false);
    }
  }, [api, chemin]);
  useEffect(() => void recharger(), [recharger]);
  return { liste, setChemin, message, setMessage, charge, recharger };
}

type Dossier = ReturnType<typeof useDossier>;

// Chaque geste modifie l'appareil puis relit le dossier : l'écran montre toujours l'état réel, pas une supposition.
function gestes(api: ApiAppareil, d: Dossier, ouvert: FichierOuvert | null, fermer: () => void) {
  const ici = (nom: string): string => joindre(d.liste?.chemin ?? '~', nom);
  async function agir(f: () => Promise<void>, ok: string): Promise<void> {
    try {
      await f();
      d.setMessage(ok);
      await d.recharger();
    } catch (e) {
      d.setMessage(e instanceof ErreurApi ? e.message : String(e));
    }
  }
  return {
    ici,
    creerDossier: (nom: string) => agir(() => api.creerDossier(ici(nom)), `Dossier « ${nom} » créé.`),
    renommer: (e: EntreeFichier, nom: string) =>
      agir(() => api.renommer(ici(e.nom), ici(nom)), `Renommé en « ${nom} ».`),
    supprimer: (e: EntreeFichier) =>
      agir(async () => {
        await api.supprimer(ici(e.nom));
        if (ouvert?.chemin === ici(e.nom)) fermer();
      }, `« ${e.nom} » supprimé.`),
    deposer: (fichiers: readonly File[]) =>
      agir(async () => {
        for (const f of fichiers) await api.deposer(ici(f.name), f);
      }, `${fichiers.length} fichier(s) déposé(s).`),
    telecharger: (e: EntreeFichier) => agir(() => api.telecharger(ici(e.nom), e.nom), `« ${e.nom} » téléchargé.`),
  };
}

export function useExplorateur(api: ApiAppareil) {
  const d = useDossier(api);
  const [caches, setCaches] = useState(false);
  const [ouvert, setOuvert] = useState<FichierOuvert | null>(null);
  const g = gestes(api, d, ouvert, () => setOuvert(null));
  return {
    ...g,
    machine: api.machine,
    liste: d.liste,
    message: d.message,
    charge: d.charge,
    caches,
    ouvert,
    entrees: d.liste ? trier(d.liste.entrees, caches) : [],
    basculerCaches: () => setCaches((c) => !c),
    aller: (c: string | undefined) => {
      d.setChemin(c);
      setOuvert(null);
    },
    ouvrir: (e: EntreeFichier) => {
      if (e.type !== 'dossier') return setOuvert({ chemin: g.ici(e.nom), entree: e });
      d.setChemin(g.ici(e.nom));
      setOuvert(null);
    },
    fermer: () => setOuvert(null),
    recharger: () => void d.recharger(),
  };
}

export type Explorateur = ReturnType<typeof useExplorateur>;
