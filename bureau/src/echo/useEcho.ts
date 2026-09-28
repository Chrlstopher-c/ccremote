// Responsabilité : l'état du mode Echo — historique, réponse en cours, ce qu'Echo a entendu, cadres, réglages, et le
// niveau sonore (tenu hors de React : l'orbe le lit à chaque image sans re-rendre la vue).
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type {
  CadreEcho,
  CommandeVoix,
  EntreeHistoriqueEcho,
  EtatVoixEcho,
  MessageEcho,
  ReglagesEcho,
  ContexteEcho,
  McpEcho,
  UsageEcho,
} from '../../../commun/echo.ts';
import { ErreurApi } from '../shared/api/client.ts';
import { useMagasin } from '../shared/etat/contexte.tsx';
import { journal } from '../shared/journal.ts';

export type Disponibilite = 'chargement' | 'ok' | 'injoignable' | 'absente';

export interface EnCours {
  readonly texte: string;
  readonly outils: readonly string[];
}

export interface Niveaux {
  micro: number;
  voix: number;
  tMicro: number;
  tVoix: number;
}

export interface Entendu {
  readonly texte: string;
  readonly eveil: boolean;
  readonly score: number | null;
  readonly refusee: boolean;
}

const VIDE: EnCours = { texte: '', outils: [] };

/** Ce qui décrit Echo elle-même : réglages, cadres, voix, consommation, outils. */
function useEtatSysteme() {
  const [reglages, setReglages] = useState<ReglagesEcho>({ micro: true, voix: true });
  const [cadres, setCadres] = useState<readonly CadreEcho[]>([]);
  const [voix, setVoix] = useState<EtatVoixEcho | null>(null);
  const [usage, setUsage] = useState<UsageEcho | null>(null);
  const [mcp, setMcp] = useState<readonly McpEcho[]>([]);
  const [contexte, setContexte] = useState<ContexteEcho | null>(null);
  return {
    reglages,
    setReglages,
    cadres,
    setCadres,
    voix,
    setVoix,
    usage,
    setUsage,
    mcp,
    setMcp,
    contexte,
    setContexte,
  };
}

/** La conversation : historique, réponse en cours, occupation, joignabilité, dernière phrase entendue. */
function useEtatEcho() {
  const [historique, setHistorique] = useState<readonly EntreeHistoriqueEcho[]>([]);
  const [enCours, setEnCours] = useState<EnCours>(VIDE);
  const [occupe, setOccupe] = useState(false);
  const [dispo, setDispo] = useState<Disponibilite>('chargement');
  const [entendu, setEntendu] = useState<Entendu | null>(null);
  const niveaux = useRef<Niveaux>({ micro: 0, voix: 0, tMicro: 0, tVoix: 0 });
  const conversation = { historique, setHistorique, enCours, setEnCours, occupe, setOccupe, dispo, setDispo };
  return { ...conversation, entendu, setEntendu, niveaux, ...useEtatSysteme() };
}

type Etat = ReturnType<typeof useEtatEcho>;

function noterNiveau(n: RefObject<Niveaux>, m: Extract<MessageEcho, { type: 'niveau' }>): void {
  const t = performance.now();
  if (m.source === 'micro') Object.assign(n.current, { micro: m.v, tMicro: t });
  else Object.assign(n.current, { voix: m.v, tVoix: t });
}

function recevoir(e: Etat, m: MessageEcho, relire: () => void): void {
  if (m.type === 'niveau') noterNiveau(e.niveaux, m);
  else if (m.type === 'delta') e.setEnCours((x) => ({ ...x, texte: x.texte + m.texte }));
  else if (m.type === 'outil') e.setEnCours((x) => ({ ...x, outils: [...x.outils, m.nom] }));
  else if (m.type === 'etat') e.setOccupe(m.occupe);
  else if (m.type === 'reglages') e.setReglages(m.reglages);
  else if (m.type === 'cadres') e.setCadres(m.cadres);
  else if (m.type === 'entendu') {
    e.setEntendu({ texte: m.texte, eveil: m.eveil, score: m.score ?? null, refusee: m.refusee ?? false });
  } else if (m.type === 'voix') e.setVoix(m.etat);
  else if (m.type === 'usage') e.setUsage(m.usage);
  else if (m.type === 'mcp') e.setMcp(m.serveurs);
  else if (m.type === 'contexte') e.setContexte(m.etat);
  else if (m.type === 'fin') {
    e.setEnCours(VIDE);
    relire();
  }
}

function disponibiliteDe(erreur: unknown): Disponibilite {
  return erreur instanceof ErreurApi && erreur.statut === 404 ? 'absente' : 'injoignable';
}

export function useEcho() {
  const magasin = useMagasin();
  const e = useEtatEcho();
  const { setOccupe, setHistorique, setDispo, setReglages, setCadres, setVoix } = e;
  const relire = useCallback(async (): Promise<void> => {
    try {
      const [etat, h] = await Promise.all([magasin.client.echoEtat(), magasin.client.echoHistorique()]);
      setOccupe(etat.occupe);
      setReglages(etat.reglages);
      setCadres(etat.cadres);
      setVoix(etat.voix);
      e.setUsage(etat.usage);
      e.setMcp(etat.mcp);
      e.setContexte(etat.contexte);
      setHistorique(h);
      setDispo(etat.joignable ? 'ok' : 'injoignable');
    } catch (erreur) {
      journal.warn({ erreur: String(erreur) }, 'Echo non chargée');
      setDispo(disponibiliteDe(erreur));
    }
  }, [magasin, setOccupe, setReglages, setCadres, setHistorique, setDispo, setVoix]);
  const etat = useRef(e);
  etat.current = e;
  useEffect(() => {
    void relire();
    return magasin.ecouterEcho((m) => recevoir(etat.current, m, () => void relire()));
  }, [magasin, relire]);
  return { ...e, ...useActionsEcho(e) };
}

function useTenter(setDispo: (d: Disponibilite) => void) {
  return useCallback(
    async (f: () => Promise<unknown>, quoi: string): Promise<boolean> => {
      try {
        await f();
        return true;
      } catch (erreur) {
        journal.warn({ erreur: String(erreur) }, quoi);
        setDispo(disponibiliteDe(erreur));
        return false;
      }
    },
    [setDispo],
  );
}

function useActionsEcho(e: Etat) {
  const client = useMagasin().client;
  const { setHistorique, setReglages, setCadres } = e;
  const tenter = useTenter(e.setDispo);
  const envoyer = useCallback(
    (texte: string): Promise<boolean> => {
      setHistorique((h) => [...h, { ts: new Date().toISOString(), qui: 'chris', origine: 'quart:app', texte }]);
      return tenter(() => client.echoParler(texte), 'message à Echo non envoyé');
    },
    [client, setHistorique, tenter],
  );
  const interrompre = useCallback(
    () => void tenter(() => client.echoInterrompre(), 'interruption refusée'),
    [client, tenter],
  );
  const regler = useCallback(
    (r: Partial<ReglagesEcho>): void => {
      setReglages((x) => ({ ...x, ...r })); // optimiste : Echo renverra l'état réel
      void tenter(() => client.echoRegler(r), 'réglage refusé');
    },
    [client, setReglages, tenter],
  );
  const retirer = useCallback(
    (id: string): void => {
      setCadres((c) => c.filter((x) => x.id !== id));
      void tenter(() => client.echoRetirer(id), 'cadre non retiré');
    },
    [client, setCadres, tenter],
  );
  return { envoyer, interrompre, regler, retirer, ...useActionsSysteme(e, tenter) };
}

type Tenter = ReturnType<typeof useTenter>;

/** Relancer Echo, piloter son empreinte vocale. */
function useActionsSysteme(e: Etat, tenter: Tenter) {
  const client = useMagasin().client;
  const { setMcp } = e;
  const relancer = useCallback((): void => {
    setMcp([]);
    void tenter(() => client.echoRedemarrer(), 'relance refusée');
  }, [client, tenter, setMcp]);
  const commanderVoix = useCallback(
    (action: CommandeVoix): void => void tenter(() => client.echoVoix(action), 'commande de voix refusée'),
    [client, tenter],
  );
  const compacter = useCallback(
    (): void => void tenter(() => client.echoCompacter(), 'compaction refusée'),
    [client, tenter],
  );
  return { relancer, commanderVoix, compacter };
}
