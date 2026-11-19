import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { ApiSessions } from './api-sessions.ts';
import { Diffusion } from './diffusion.ts';

const MAJ = '2026-11-18T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string, cwd = '/p'): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: cwd, nom: 'p' },
    cwd,
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

function fauxPostes(reponse: ReponsePoste): { postes: Postes; appels: unknown[] } {
  const appels: unknown[] = [];
  const postes = {
    commander: (_machine: string, c: unknown) => {
      appels.push(c);
      return Promise.resolve(reponse);
    },
    decouvertes: () => [],
  } as unknown as Postes;
  return { postes, appels };
}

function requete(
  chemin: string,
  corps?: unknown,
  params: { id: string } = { id: '' },
): Request & { params: { id: string } } {
  const init: RequestInit = corps === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(corps) };
  return Object.assign(new Request(`http://relais.test${chemin}`, init), { params });
}

function api(reponse: ReponsePoste): { r: Registre; appels: unknown[]; api: ApiSessions } {
  const r = new Registre(ouvrirBase(':memory:'));
  r.enregistrerMachine({
    id: 'tour',
    description: '',
    racines: [],
    projets: [],
    comptes: [],
    version: '',
    derniereVue: MAJ,
  } as never);
  const { postes, appels } = fauxPostes(reponse);
  return { r, appels, api: new ApiSessions(r, postes, new Diffusion(), new Set(), journal) };
}

describe('suppression d une session', () => {
  test('le poste retire le transcript, puis la fiche disparaît du relais', async () => {
    const { r, appels, api: a } = api({ ok: true });
    r.enregistrerSession(session('s1'));
    const rep = await a.supprimer(requete('/api/sessions/s1/supprimer', undefined, { id: 's1' }));
    expect(rep.status).toBe(200);
    expect(appels).toEqual([{ kind: 'supprimer', sessionId: 's1' }]);
    expect(r.session('s1')).toBeNull();
  });

  test('un refus du poste garde la session au relais', async () => {
    const { r, api: a } = api({ ok: false, erreur: 'session ouverte dans un terminal' });
    r.enregistrerSession(session('s1'));
    const rep = await a.supprimer(requete('/api/sessions/s1/supprimer', undefined, { id: 's1' }));
    expect(rep.status).toBe(409);
    expect(r.session('s1')).not.toBeNull();
  });

  test('une session inconnue ne part pas au poste', async () => {
    const { appels, api: a } = api({ ok: true });
    const rep = await a.supprimer(requete('/api/sessions/x/supprimer', undefined, { id: 'x' }));
    expect(rep.status).toBe(404);
    expect(appels).toEqual([]);
  });

  test('la suppression se diffuse aux autres clients, pour qu aucun ne garde la ligne', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerMachine({ id: 'tour', description: '', racines: [], projets: [], comptes: [], version: '', derniereVue: MAJ } as never);
    const diffusion = new Diffusion();
    const messages: unknown[] = [];
    diffusion.diffuser = (m) => messages.push(m);
    const a = new ApiSessions(r, fauxPostes({ ok: true }).postes, diffusion, new Set(), journal);
    r.enregistrerSession(session('s1'));
    await a.supprimer(requete('/api/sessions/s1/supprimer', undefined, { id: 's1' }));
    expect(messages).toEqual([{ type: 'supprimee', id: 's1' }]);
  });

  test('la suppression retire aussi les événements de la session', async () => {
    const { r, api: a } = api({ ok: true });
    r.enregistrerSession(session('s1'));
    r.ajouterEvenement('s1', MAJ, { type: 'message', texte: 'bonjour' } as never);
    await a.supprimer(requete('/api/sessions/s1/supprimer', undefined, { id: 's1' }));
    expect(r.evenements('s1', 0)).toEqual([]);
  });
});

describe('environnements', () => {
  test('un environnement enregistré est proposé en tête, sans doublon avec les sessions récentes', async () => {
    const { r, api: a } = api({ ok: true });
    r.enregistrerSession(session('s1', '/travail/projet'));
    r.enregistrerSession(session('s2', '/autre'));
    const rep = await a.enregistrerEnvironnement(
      new Request('http://relais.test/api/environnements', {
        method: 'POST',
        body: JSON.stringify({ machine: 'tour', dossier: '/autre' }),
      }),
    );
    expect(rep.status).toBe(201);
    const liste = (await a.environnements().json()) as { dossier: string; enregistre: boolean }[];
    expect(liste.map((e) => [e.dossier, e.enregistre])).toEqual([
      ['/autre', true],
      ['/travail/projet', false],
    ]);
  });

  test('une machine inconnue ne peut pas recevoir un environnement', async () => {
    const { api: a } = api({ ok: true });
    const rep = await a.enregistrerEnvironnement(
      new Request('http://relais.test/api/environnements', {
        method: 'POST',
        body: JSON.stringify({ machine: 'inconnue', dossier: '/x' }),
      }),
    );
    expect(rep.status).toBe(404);
  });
});

describe('import des sessions Claude Code', () => {
  test('la liste part au poste de la machine demandée', async () => {
    const { appels, api: a } = api({ ok: true, donnees: [{ id: 'x' }] });
    const rep = await a.importables(requete('/api/machines/tour/importables', undefined, { id: 'tour' }));
    expect(await rep.json()).toEqual([{ id: 'x' }]);
    expect(appels).toEqual([{ kind: 'importables' }]);
  });

  test('l import envoie les identifiants choisis, validés avant le poste', async () => {
    const { appels, api: a } = api({ ok: true, donnees: { importees: 1, absentes: [] } });
    const ok = await a.importer(requete('/api/machines/tour/importer', { ids: ['abc-123'] }, { id: 'tour' }));
    expect(ok.status).toBe(200);
    expect(appels).toEqual([{ kind: 'importer', ids: ['abc-123'] }]);
    const mauvais = await a.importer(requete('/api/machines/tour/importer', { ids: ['../x'] }, { id: 'tour' }));
    expect(mauvais.status).toBe(400);
    expect(appels.length).toBe(1);
  });
});
