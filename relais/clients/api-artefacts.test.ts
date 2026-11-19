import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { ApiArtefacts } from './api-artefacts.ts';

const MAJ = '2026-11-18T10:00:00.000Z';
const ID = '0123456789abcdef';
const journal = pino({ enabled: false });

function session(id: string, machine: string): ResumeSession {
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
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: id,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

const ARTEFACT = {
  id: ID,
  session: 's1',
  titre: 'Tableau',
  url: null,
  publieLe: MAJ,
  epingle: false,
  chemin: '/p/Tableau.html',
  versions: [{ version: 1, fichier: `${ID}-v1`, publieLe: MAJ }],
};

/** Postes simulés : une réponse par machine (absente = hors ligne), et les commandes reçues. */
function postesSimules(parMachine: Record<string, ReponsePoste>): { postes: Postes; recues: unknown[] } {
  const recues: unknown[] = [];
  const postes = {
    commander: (machine: string, commande: unknown) => {
      recues.push({ machine, commande });
      return Promise.resolve(parMachine[machine] ?? { ok: false, erreur: `${machine} est hors ligne` });
    },
  } as unknown as Postes;
  return { postes, recues };
}

function api(parMachine: Record<string, ReponsePoste>): { api: ApiArtefacts; recues: unknown[] } {
  const registre = new Registre(ouvrirBase(':memory:'));
  registre.enregistrerSession(session('s1', 'tour'));
  registre.enregistrerSession(session('s2', 'pi'));
  const { postes, recues } = postesSimules(parMachine);
  return { api: new ApiArtefacts(registre, postes, journal), recues };
}

function requete(id: string, artefact: string, corps?: unknown): Request & { params: Record<string, string> } {
  const init: RequestInit = corps === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(corps) };
  return Object.assign(new Request('http://relais.test/api/sessions', init), { params: { id, artefact } });
}

describe('liste des artefacts', () => {
  test('rassemble les sessions dont le poste répond et ignore un poste hors ligne', async () => {
    const { api: a } = api({ tour: { ok: true, donnees: [{ ...ARTEFACT, session: 's1' }] } });
    const reponse = await a.lister();
    expect(reponse.status).toBe(200);
    const corps = (await reponse.json()) as unknown[];
    expect(corps).toHaveLength(1);
    expect(corps[0]).toMatchObject({ id: ID, session: 's1', epingle: false });
  });

  test('une réponse de poste illisible est ignorée sans erreur globale', async () => {
    const { api: a } = api({ tour: { ok: true, donnees: [{ pas: 'un artefact' }] } });
    expect(await (await a.lister()).json()).toEqual([]);
  });
});

describe('gestes sur un artefact', () => {
  test('renommer transmet la commande au poste de la session et rend sa réponse', async () => {
    const { api: a, recues } = api({ tour: { ok: true, donnees: { ...ARTEFACT, titre: 'Bilan' } } });
    const reponse = await a.renommer(requete('s1', ID, { titre: '  Bilan ' }));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({ titre: 'Bilan' });
    expect(recues).toEqual([
      { machine: 'tour', commande: { kind: 'artefact_renommer', sessionId: 's1', artefact: ID, titre: 'Bilan' } },
    ]);
  });

  test('épingler exige un booléen', async () => {
    const { api: a, recues } = api({ tour: { ok: true, donnees: ARTEFACT } });
    expect((await a.epingler(requete('s1', ID, { epingle: 'oui' }))).status).toBe(400);
    expect((await a.epingler(requete('s1', ID, { epingle: true }))).status).toBe(200);
    expect(recues).toEqual([
      { machine: 'tour', commande: { kind: 'artefact_epingler', sessionId: 's1', artefact: ID, epingle: true } },
    ]);
  });

  test('dupliquer et supprimer partent vers le poste', async () => {
    const { api: a, recues } = api({ tour: { ok: true, donnees: ARTEFACT } });
    expect((await a.dupliquer(requete('s1', ID, {}))).status).toBe(200);
    expect((await a.supprimer(requete('s1', ID, {}))).status).toBe(200);
    expect(recues.map((r) => (r as { commande: { kind: string } }).commande.kind)).toEqual([
      'artefact_dupliquer',
      'artefact_supprimer',
    ]);
  });

  test('une session inconnue ou un identifiant d’artefact invalide donne 404 sans rien envoyer', async () => {
    const { api: a, recues } = api({ tour: { ok: true, donnees: ARTEFACT } });
    expect((await a.renommer(requete('absente', ID, { titre: 'x' }))).status).toBe(404);
    expect((await a.supprimer(requete('s1', '../etc', {}))).status).toBe(404);
    expect(recues).toEqual([]);
  });

  test('un refus du poste part au client avec son message et le statut 409', async () => {
    const { api: a } = api({ tour: { ok: false, erreur: 'artefact inconnu : ' + ID } });
    const reponse = await a.supprimer(requete('s1', ID, {}));
    expect(reponse.status).toBe(409);
    expect(await reponse.json()).toEqual({ erreur: `artefact inconnu : ${ID}` });
  });
});
