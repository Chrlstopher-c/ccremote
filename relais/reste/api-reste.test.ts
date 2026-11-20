// Responsabilité : tests de la façade « reste » du relais — fusion registre/transcripts, bornes, délai et refus d'un
// poste, mémoire et commandes (validation, 409 sur doublon). Registre et postes simulés : aucune machine contactée.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import type { VueMachine } from '../../commun/api-clients.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { ApiReste, type DependancesReste } from './api-reste.ts';

const JOURNAL = { warn: () => undefined, info: () => undefined } as unknown as Logger;
const MAJ = '2026-11-19T10:00:00.000Z';
type Commande = Parameters<Postes['commander']>[1];
type Requete = Request & { params: Record<string, string> };

function vue(id: string, enLigne: boolean): VueMachine {
  return {
    id,
    description: id,
    racines: [],
    projets: [],
    comptes: [],
    etatComptes: [],
    version: '2.0.0',
    etat: null,
    derniereVue: MAJ,
    enLigne,
  };
}

function fiche(id: string, machine: string, claudeSessionId: string | null = null): ResumeSession {
  return {
    id,
    machine,
    projet: { machine, chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1 },
    etapes: 0,
    compactions: 0,
    claudeSessionId,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function trans(sessionId: string, ts: string, extrait = 'un zebre'): Record<string, unknown> {
  return { sessionId, dossier: '/p', titre: sessionId, ts, role: 'claude', extrait, debut: 3, longueur: 5 };
}

interface Options {
  readonly reponses?: Record<string, unknown>;
  readonly refus?: Record<string, string>;
  readonly silence?: string[];
  readonly delaiRechercheMs?: number;
}

function monter(options: Options = {}) {
  const envoyes: { id: string; commande: Commande }[] = [];
  const d: DependancesReste = {
    registre: {
      rechercherMessages: () => [
        {
          seq: 9,
          sessionId: 'relais-1',
          machine: 'tour',
          titre: 'Session relais',
          dossier: '/p',
          ts: '2026-11-19T12:00:00.000Z',
          role: 'chris',
          extrait: 'zebre dans le registre',
          debut: 0,
          longueur: 5,
        },
      ],
      jetonsSession: () => ({ entree: 13, sortie: 7, tours: 2 }),
      sessions: () => [fiche('K', 'tour', 'K-SDK'), fiche('relais-1', 'tour')],
    },
    postes: {
      vues: () => [vue('tour', true), vue('portable', false)],
      enLigne: (id: string) => id === 'tour',
      infosPoste: () => null,
      commander: async (id: string, commande: Commande) => {
        envoyes.push({ id, commande });
        if (options.silence?.includes(commande.kind)) return new Promise(() => undefined);
        const refus = options.refus?.[commande.kind];
        if (refus) return { ok: false, erreur: refus };
        return { ok: true, donnees: options.reponses?.[commande.kind] ?? {} };
      },
    } as unknown as DependancesReste['postes'],
    journal: JOURNAL,
    delaiRechercheMs: options.delaiRechercheMs,
  };
  return { api: new ApiReste(d), envoyes };
}

const CORPS_COMMANDE = { nom: 'bilan', description: 'Bilan', contenu: 'Résume' };

function requeteAvecCorps(url: string, id: string, corps: unknown): Requete {
  return Object.assign(new Request(`http://relais.test${url}`, { method: 'POST', body: JSON.stringify(corps) }), {
    params: { id },
  });
}

function requete(url: string, id?: string): Requete {
  return Object.assign(new Request(`http://relais.test${url}`), { params: { id: id ?? '' } });
}

describe('recherche globale', () => {
  test('q trop courte : résultats vides, aucun poste interrogé', async () => {
    const { api, envoyes } = monter();
    const r = await api.recherche(requete('/api/recherche?q=z'));
    expect(await r.json()).toEqual({ resultats: [], machines: [], tronque: false });
    expect(envoyes).toHaveLength(0);
  });

  test('fusionne registre et transcripts, écarte les sessions connues, plus récent d abord', async () => {
    const { api } = monter({
      reponses: {
        rechercher_transcripts: {
          resultats: [
            trans('T-NOUVEAU', '2026-11-19T13:00:00.000Z'),
            trans('K-SDK', '2026-11-19T13:30:00.000Z'),
            trans('T-ANCIEN', '2026-11-19T09:00:00.000Z'),
          ],
        },
      },
    });
    const corps = (await (await api.recherche(requete('/api/recherche?q=zebre'))).json()) as {
      resultats: { sessionId: string; source: string; machine: string; seq: number | null }[];
      machines: { machine: string; joignable: boolean; erreur: string | null }[];
      tronque: boolean;
    };
    expect(corps.resultats.map((x) => x.sessionId)).toEqual(['T-NOUVEAU', 'relais-1', 'T-ANCIEN']);
    expect(corps.resultats.find((x) => x.sessionId === 'relais-1')).toMatchObject({ source: 'relais', seq: 9 });
    expect(corps.resultats.find((x) => x.sessionId === 'T-NOUVEAU')).toMatchObject({
      source: 'transcript',
      machine: 'tour',
      seq: null,
    });
    expect(corps.machines).toEqual([
      { machine: 'tour', joignable: true, erreur: null },
      { machine: 'portable', joignable: false, erreur: 'hors ligne' },
    ]);
    expect(corps.tronque).toBe(false);
  });

  test('au plus trois occurrences par session de transcript', async () => {
    const une = [1, 2, 3, 4].map((n) => trans('T-UNE', `2026-11-19T10:0${n}:00.000Z`));
    const { api } = monter({ reponses: { rechercher_transcripts: { resultats: une } } });
    const corps = (await (await api.recherche(requete('/api/recherche?q=zebre&limite=50'))).json()) as {
      resultats: { ts: string }[];
    };
    expect(corps.resultats.map((x) => x.ts)).toEqual([
      '2026-11-19T12:00:00.000Z',
      '2026-11-19T10:04:00.000Z',
      '2026-11-19T10:03:00.000Z',
      '2026-11-19T10:02:00.000Z',
    ]);
  });

  test('coupe à la limite demandée et le signale', async () => {
    const une = [1, 2, 3].map((n) => trans(`T-${n}`, `2026-11-19T10:0${n}:00.000Z`));
    const { api } = monter({ reponses: { rechercher_transcripts: { resultats: une } } });
    const corps = (await (await api.recherche(requete('/api/recherche?q=zebre&limite=2'))).json()) as {
      resultats: { ts: string }[];
      tronque: boolean;
    };
    expect(corps.resultats.map((x) => x.ts)).toEqual(['2026-11-19T12:00:00.000Z', '2026-11-19T10:03:00.000Z']);
    expect(corps.tronque).toBe(true);
  });

  test('un poste qui ne répond pas à temps est signalé, la recherche rend ce qu elle a', async () => {
    const { api } = monter({ silence: ['rechercher_transcripts'], delaiRechercheMs: 5 });
    const corps = (await (await api.recherche(requete('/api/recherche?q=zebre'))).json()) as {
      machines: { machine: string; joignable: boolean; erreur: string | null }[];
      resultats: unknown[];
    };
    expect(corps.machines[0]).toEqual({ machine: 'tour', joignable: false, erreur: 'pas de réponse à temps' });
    expect(corps.resultats).toHaveLength(1);
  });

  test('réponse de poste illisible : machine signalée, rien d inventé', async () => {
    const { api } = monter({ reponses: { rechercher_transcripts: { pas: 'la bonne forme' } } });
    const corps = (await (await api.recherche(requete('/api/recherche?q=zebre'))).json()) as {
      machines: { erreur: string | null }[];
    };
    expect(corps.machines[0]?.erreur).toBe('réponse illisible');
  });

  test('requête trop longue : 400', async () => {
    const { api } = monter();
    const longue = 'a'.repeat(201);
    expect((await api.recherche(requete(`/api/recherche?q=${longue}`))).status).toBe(400);
  });
});

describe('mémoire, jetons et commandes', () => {
  test('mémoire : machine inconnue 404, outil hors liste 400, fiche sans projet 400', async () => {
    const { api, envoyes } = monter();
    expect((await api.memoire(requete('/api/machines/x/memoire?outil=projets', 'x'))).status).toBe(404);
    expect((await api.memoire(requete('/api/machines/tour/memoire?outil=ecrire', 'tour'))).status).toBe(400);
    expect((await api.memoire(requete('/api/machines/tour/memoire?outil=fiche', 'tour'))).status).toBe(400);
    expect(envoyes).toHaveLength(0);
  });

  test('mémoire : commande de lecture au poste, jours par défaut à 7', async () => {
    const reponse = { etat: 'ok', outil: 'recap', texte: 'récap' };
    const { api, envoyes } = monter({ reponses: { memoire_lire: reponse } });
    const r = await api.memoire(requete('/api/machines/tour/memoire?outil=recap', 'tour'));
    expect(await r.json()).toEqual(reponse);
    expect(envoyes[0]?.commande).toEqual({ kind: 'memoire_lire', outil: 'recap', jours: 7 });
  });

  test('jetons : somme du registre', async () => {
    const { api } = monter();
    expect(await api.jetons(requete('/api/sessions/s/jetons', 's')).json()).toEqual({
      entree: 13,
      sortie: 7,
      tours: 2,
    });
  });

  test('commandes : liste du poste', async () => {
    const liste = { commandes: [{ nom: 'bilan', description: 'Bilan', chemin: 'commands/bilan.md' }] };
    const { api } = monter({ reponses: { commandes_lister: liste } });
    expect(await (await api.commandes(requete('/api/machines/tour/commandes', 'tour'))).json()).toEqual(liste);
  });

  test('création : 201 quand le poste écrit la commande', async () => {
    const { api, envoyes } = monter();
    const reponse = await api.creerCommande(requeteAvecCorps('/api/machines/tour/commandes', 'tour', CORPS_COMMANDE));
    expect(reponse.status).toBe(201);
    expect(await reponse.json()).toEqual({ nom: 'bilan' });
    expect(envoyes[0]?.commande).toEqual({ kind: 'commande_creer', ...CORPS_COMMANDE });
  });

  test('création : 409 avec le message exact quand le fichier existe déjà', async () => {
    const { api } = monter({ refus: { commande_creer: 'commande_existante' } });
    const reponse = await api.creerCommande(requeteAvecCorps('/api/machines/tour/commandes', 'tour', CORPS_COMMANDE));
    expect(reponse.status).toBe(409);
    expect(await reponse.json()).toEqual({ erreur: 'Une commande de ce nom existe déjà' });
  });

  test('création : nom invalide refusé en 400 avant le poste', async () => {
    const { api, envoyes } = monter();
    const corps = { nom: '../x', description: '', contenu: 'x' };
    const reponse = await api.creerCommande(requeteAvecCorps('/api/machines/tour/commandes', 'tour', corps));
    expect(reponse.status).toBe(400);
    expect(envoyes).toHaveLength(0);
  });
});
