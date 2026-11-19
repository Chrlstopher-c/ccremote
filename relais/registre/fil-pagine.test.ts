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
