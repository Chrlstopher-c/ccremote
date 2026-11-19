import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import type { Postes } from '../parc/postes.ts';
import type { EvenementDate } from '../../commun/api-clients.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const MAJ = '2026-11-19T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function registreAvec(nombre: number): Registre {
  const r = new Registre(ouvrirBase(':memory:'));
  r.enregistrerSession(session('a'));
  for (let i = 1; i <= nombre; i++) r.ajouterEvenement('a', MAJ, { type: 'texte', texte: `t${i}`, uuid: `u${i}` });
  return r;
}

function requete(id: string, query: string): Request & { params: { id: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/evenements${query}`), { params: { id } });
}

const postes = {} as unknown as Postes;

describe('fil paginé : evenementsAvant et chapitres', () => {
  test('evenementsAvant rend les limite événements qui précèdent le rang, en ordre croissant', () => {
    const r = registreAvec(10);
    const page = r.evenementsAvant('a', 8, 3);
    expect(page.map((e) => e.seq)).toEqual([5, 6, 7]);
    expect(r.evenementsAvant('a', 2, 5).map((e) => e.seq)).toEqual([1]);
    expect(r.evenementsAvant('a', 1, 5)).toEqual([]);
  });

  test('la page ne contient jamais le rang demandé ni les suivants', () => {
    const r = registreAvec(5);
    expect(r.evenementsAvant('a', 4, 100).every((e) => e.seq < 4)).toBe(true);
  });

  test('chapitres : seul le dernier état de chaque message compte', () => {
    const r = registreAvec(3);
    r.ajouterEvenement('a', MAJ, { type: 'chapitre', uuid: 'u1', epingle: true });
    r.ajouterEvenement('a', MAJ, { type: 'chapitre', uuid: 'u2', epingle: true });
    r.ajouterEvenement('a', MAJ, { type: 'chapitre', uuid: 'u1', epingle: false });
    expect(r.chapitresEpingles('a')).toEqual(['u2']);
  });

  test('GET evenements?avant&limite rend la page ; limite bornée à 1000 ; sans avant, rien ne change', async () => {
    const r = registreAvec(1500);
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const page = (await (await api.evenements(requete('a', '?avant=1001&limite=5000'))).json()) as EvenementDate[];
    expect(page).toHaveLength(1000);
    expect(page[0]?.seq).toBe(1);
    const derniers = (await (await api.evenements(requete('a', ''))).json()) as EvenementDate[];
    expect(derniers).toHaveLength(300);
    expect(derniers[299]?.seq).toBe(1500);
  });

  test('GET evenements?apres&limite rend la page suivante sans attendre ; limite bornée à 1000', async () => {
    const r = registreAvec(1500);
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const page = (await (await api.evenements(requete('a', '?apres=300&limite=300'))).json()) as EvenementDate[];
    expect(page.map((e) => e.seq)).toEqual(Array.from({ length: 300 }, (_, i) => 301 + i));
    const borne = (await (await api.evenements(requete('a', '?apres=0&limite=9999'))).json()) as EvenementDate[];
    expect(borne).toHaveLength(1000);
    const fin = (await (await api.evenements(requete('a', '?apres=1500&limite=300'))).json()) as EvenementDate[];
    expect(fin).toEqual([]);
  });

  test('recherche dans tout le fil : sans casse, messages seuls, les plus récents en ordre croissant, total exact', async () => {
    const r = registreAvec(5);
    r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'Rapport Lanterne', uuid: 'm1' });
    r.ajouterEvenement('a', MAJ, { type: 'outil', id: 'o1', nom: 'Bash', entree: 'lanterne', etat: 'termine' } as never);
    r.ajouterEvenement('a', MAJ, { type: 'texte', texte: 'lanterne encore', uuid: 'u9' });
    expect(r.rechercherFil('a', 'LANTERNE', 50).total).toBe(2);
    expect(r.rechercherFil('a', 'lanterne', 1).resultats.map((e) => e.seq)).toEqual([8]);
    expect(r.rechercherFil('a', '', 50)).toEqual({ total: 0, resultats: [] });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const reponse = await api.rechercherFil(Object.assign(new Request('http://x/r?q=t3&limite=5'), { params: { id: 'a' } }) as never);
    expect(((await reponse.json()) as { total: number }).total).toBe(1);
    expect((await api.rechercherFil(Object.assign(new Request('http://x/r?q=t'), { params: { id: 'zz' } }) as never)).status).toBe(404);
  });

  test('GET chapitres : liste des uuid épinglés, 404 pour une session inconnue', async () => {
    const r = registreAvec(2);
    r.ajouterEvenement('a', MAJ, { type: 'chapitre', uuid: 'u2', epingle: true });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const chapitres = (req: Request & { params: { id: string } }) => api.chapitres(req as never);
    expect(
      (await (await chapitres(Object.assign(new Request('http://x/c'), { params: { id: 'a' } }))).json()) as string[],
    ).toEqual(['u2']);
    expect((await chapitres(Object.assign(new Request('http://x/c'), { params: { id: 'zz' } }))).status).toBe(404);
  });
});
