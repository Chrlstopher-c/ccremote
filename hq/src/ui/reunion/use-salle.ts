// Responsabilité : l'état de la salle de réunion — réunions passées, réunion courante (rafraîchie pendant que les
// agents répondent), participants choisis ou mode « Auto », envoi d'une demande de Chris et erreurs d'envoi.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { configRelais } from '../config-relais';
import { journaliser } from '../../donnees';
import {
  ClientReunions,
  creerReunionsDemo,
  type ApiReunions,
  type EnvoiReunion,
  type Reunion,
} from '../../donnees';
import { useMondeBrut } from '../contexte';

const RAFRAICHIR_MS = 3_000;

// La démo garde ses réunions en mémoire : une seule instance pour toute la vie de la page.
let demoPartagee: ApiReunions | null = null;

function useApi(): ApiReunions {
  const { source, magasin } = useMondeBrut();
  return useMemo(() => {
    const config = source.nom === 'demo' ? null : configRelais();
    if (config && config.source === 'relais') {
      return new ClientReunions(config.base, config.jeton, (url, init) => fetch(url, init));
    }
    demoPartagee ??= creerReunionsDemo(undefined, () => magasin.lire().sessions);
    return demoPartagee;
  }, [source, magasin]);
}

function texteErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

function remplacer(liste: readonly Reunion[], r: Reunion): Reunion[] {
  return [r, ...liste.filter((x) => x.id !== r.id)];
}

function useReunions(api: ApiReunions) {
  const [reunions, setReunions] = useState<readonly Reunion[]>([]);
  const [courante, setCourante] = useState<Reunion | null>(null);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    api.lister().then(
      (l) => setReunions([...l].sort((a, b) => b.creeLe.localeCompare(a.creeLe))),
      (e: unknown) => {
        journaliser('warn', 'réunions illisibles', { erreur: texteErreur(e) });
        setErreur(`Réunions passées indisponibles : ${texteErreur(e)}`);
      },
    );
  }, [api]);
  const id = courante?.id;
  useEffect(() => {
    if (!id) return;
    const minuteur = setInterval(() => {
      api.ouvrir(id).then(
        (r) => setCourante((c) => (c && c.id === r.id && c.messages.length === r.messages.length ? c : r)),
        (e: unknown) => journaliser('warn', 'réunion non rafraîchie', { id, erreur: texteErreur(e) }),
      );
    }, RAFRAICHIR_MS);
    return () => clearInterval(minuteur);
  }, [api, id]);
  const retenir = useCallback((r: Reunion) => {
    setCourante(r);
    setReunions((l) => remplacer(l, r));
  }, []);
  return { reunions, courante, setCourante, retenir, erreur, setErreur };
}

export interface Salle {
  readonly reunions: readonly Reunion[];
  readonly courante: Reunion | null;
  readonly choisis: readonly string[];
  readonly auto: boolean;
  readonly envoi: boolean;
  readonly erreur: string;
  readonly refus: readonly EnvoiReunion[];
  basculer(sessionId: string): void;
  definirAuto(auto: boolean): void;
  selectionner(r: Reunion | null): void;
  envoyer(texte: string): Promise<boolean>;
}

function useChoix() {
  const [choisis, setChoisis] = useState<readonly string[]>([]);
  const [auto, setAuto] = useState(false);
  const basculer = (id: string): void =>
    setChoisis((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  return { choisis, setChoisis, auto, setAuto, basculer };
}

export function useSalle(): Salle {
  const api = useApi();
  const r = useReunions(api);
  const { choisis, setChoisis, auto, setAuto, basculer } = useChoix();
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<readonly EnvoiReunion[]>([]);
  const selectionner = (x: Reunion | null): void => {
    r.setCourante(x);
    r.setErreur('');
    setRefus([]);
    if (x) setChoisis(x.participants);
  };
  const envoyer = async (texte: string): Promise<boolean> => {
    if (!texte.trim() || envoi || (!auto && choisis.length === 0)) return false;
    setEnvoi(true);
    r.setErreur('');
    try {
      const destinataires = auto ? 'auto' : choisis;
      const rep = await api.envoyer({ texte: texte.trim(), destinataires, reunionId: r.courante?.id });
      r.retenir(rep.reunion);
      setRefus(rep.envois.filter((e) => !e.ok));
      return true;
    } catch (e) {
      journaliser('warn', 'demande de réunion refusée', { erreur: texteErreur(e) });
      r.setErreur(`Envoi impossible : ${texteErreur(e)}`);
      return false;
    } finally {
      setEnvoi(false);
    }
  };
  return {
    reunions: r.reunions, courante: r.courante, choisis, auto, envoi, erreur: r.erreur, refus,
    basculer, definirAuto: setAuto, selectionner, envoyer,
  };
}
