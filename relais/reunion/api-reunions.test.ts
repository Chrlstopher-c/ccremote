import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type Protege, routesReunions } from './api-reunions.ts';
import { RegistreReunions } from './registre-reunions.ts';
import { SalleDeReunion } from './salle.ts';

type Requete = Request & { params: Record<string, string> };
type Gestionnaire = (req: Requete) => Response | Promise<Response>;
type Table = Record<string, Record<string, Gestionnaire>>;

const sansProtection: Protege = (g) => g;
const MAJ = '2026-11-15T10:00:00.000Z';

function session(id: string): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: `/mnt/${id}`, nom: id },
    cwd: `/mnt/${id}`,
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

function monterRoutes(): Table {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base);
  registre.enregistrerSession(session('atlas'));
  const salle = new SalleDeReunion({
    reunions: new RegistreReunions(base),
    registre,
    postes: { commander: () => Promise.resolve({ ok: true }) },
    diffusion: { diffuser: () => undefined },
    journal: pino({ enabled: false }),
    limite: 20,
  });
  // Cast justifié : Bun type les routes par méthode ; la table générique suffit à invoquer les gestionnaires en test.
  return routesReunions({ salle, journal: pino({ enabled: false }) }, sansProtection) as Table;
}

function requete(corps?: unknown, params: Record<string, string> = {}): Requete {
  const init: RequestInit = corps === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(corps) };
  return Object.assign(new Request('http://relais.test/api/reunions', init), { params });
}

describe('routes de la salle de réunion', () => {
  test('POST crée une réunion (201) et renvoie les envois', async () => {
    const routes = monterRoutes();
    const reponse = await routes['/api/reunions']?.['POST']?.(requete({ texte: 'Bonjour', destinataires: ['atlas'] }));
    expect(reponse?.status).toBe(201);
    const corps = (await reponse?.json()) as {
      reunion: { messages: unknown[] };
      envois: { sessionId: string; ok: boolean }[];
    };
    expect(corps.reunion.messages.length).toBe(1);
    expect(corps.envois).toEqual([{ sessionId: 'atlas', ok: true }]);
  });

  test('POST avec un corps invalide : 400', async () => {
    const routes = monterRoutes();
    const reponse = await routes['/api/reunions']?.['POST']?.(requete({ texte: '', destinataires: [] }));
    expect(reponse?.status).toBe(400);
  });

  test('POST sur une réunion inconnue : 404', async () => {
    const routes = monterRoutes();
    const corps = { texte: 'x', destinataires: ['atlas'], reunionId: 'absente' };
    const reponse = await routes['/api/reunions']?.['POST']?.(requete(corps));
    expect(reponse?.status).toBe(404);
  });

  test('GET liste les réunions ; GET par identifiant rend la réunion, 404 si inconnue', async () => {
    const routes = monterRoutes();
    const cree = await routes['/api/reunions']?.['POST']?.(requete({ texte: 'Bonjour', destinataires: ['atlas'] }));
    const { reunion } = (await cree?.json()) as { reunion: { id: string } };
    const liste = await routes['/api/reunions']?.['GET']?.(requete());
    expect(((await liste?.json()) as unknown[]).length).toBe(1);
    const unique = await routes['/api/reunions/:id']?.['GET']?.(requete(undefined, { id: reunion.id }));
    expect(unique?.status).toBe(200);
    const absente = await routes['/api/reunions/:id']?.['GET']?.(requete(undefined, { id: 'absente' }));
    expect(absente?.status).toBe(404);
  });
});
