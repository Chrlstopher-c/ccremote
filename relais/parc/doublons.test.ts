import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import { ResumeSession } from '../../commun/session.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { Doublons } from './doublons.ts';
import type { Postes } from './postes.ts';

const MAJ = '2026-11-22T10:00:00.000Z';
const journal = pino({ enabled: false });

function rc(id: string, conversation: string, connectee: boolean, majLe: string): ResumeSession {
  return ResumeSession.parse({
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: 'Remote Control', nom: 'Remote Control' },
    cwd: 'Remote Control',
    titre: 'Conversation',
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: connectee ? 'attente' : 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    moteur: 'claude_ai',
    distant: {
      compte: 'defaut',
      idDistant: id,
      connexion: connectee ? 'connectee' : 'deconnectee',
      probleme: null,
      conversation,
    },
    creeLe: MAJ,
    majLe,
  });
}

function poste(id: string): ResumeSession {
  return ResumeSession.parse({
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: 'Conversation',
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'conv-1',
    tmux: null,
    attachee: false,
    pilotee: false,
    terminal: true,
    creeLe: MAJ,
    majLe: MAJ,
  });
}

// Fiche de poste (conv-1) et deux jumelles : l'ancienne, déconnectée et épinglée, et la nouvelle, vivante.
function monde(): { registre: Registre; diffusion: Diffusion; messages: MessageClient[] } {
  const registre = new Registre(ouvrirBase(':memory:'));
  const diffusion = new Diffusion();
  const messages: MessageClient[] = [];
  diffusion.ecouter((m) => messages.push(m));
  registre.enregistrerSession(poste('s-poste'));
  registre.enregistrerSession(rc('cse_old', 'conv-1', false, '2026-11-22T09:00:00.000Z'));
  registre.enregistrerSession(rc('cse_new', 'conv-1', true, '2026-11-22T11:00:00.000Z'));
  registre.enregistrerSession(rc('cse_autre', 'conv-2', true, '2026-11-22T11:30:00.000Z'));
  registre.definirEpinglee('cse_old', true);
  registre.enregistrerCategories([{ id: 'cat', nom: 'Travail', replie: false, sessions: ['cse_old', 'cse_autre'] }]);
  return { registre, diffusion, messages };
}

const postesMuets = {
  commander: () => Promise.reject(new Error('le poste ne doit pas être appelé')),
  decouvertes: () => [],
} as unknown as Postes;

// Poste qui accepte la fermeture ; les commandes reçues sont relevées.
function postesAccepteurs(commandes: unknown[]): Postes {
  return {
    commander: (_machine: string, commande: unknown) => {
      commandes.push(commande);
      return Promise.resolve({ ok: true });
    },
    decouvertes: () => [],
  } as unknown as Postes;
}

function requete(id: string, action: string): Request & { params: { id: string; action: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/${action}`, { method: 'POST' }), {
    params: { id, action },
  });
}

const ids = (sessions: readonly ResumeSession[]): string[] => sessions.map((s) => s.id).sort();

describe('une conversation, une entrée (fiche de poste et jumelles Remote Control)', () => {
  test('la liste ne montre que la fiche de poste, avec le favori et la catégorie de l’ancienne jumelle', () => {
    const { registre, diffusion } = monde();
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(ids(registre.sessions(false))).toEqual(['cse_autre', 's-poste']);
    expect(registre.session('s-poste')?.epinglee).toBe(true);
    expect(registre.session('cse_old')?.epinglee).toBe(false);
    expect(registre.categories()[0]?.sessions).toEqual(['s-poste', 'cse_autre']);
  });

  test('les jumelles sont rangées dans la vue, pas supprimées de la base', () => {
    const { registre, diffusion } = monde();
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(registre.session('cse_old')?.archivee).toBe(true);
    expect(registre.session('cse_new')?.archivee).toBe(true);
    expect(ids(registre.sessions(true))).toContain('cse_old');
  });

  test('les fiches masquées sont diffusées comme rangées, et la fiche de poste comme favorite', () => {
    const { registre, diffusion, messages } = monde();
    new Doublons(registre, diffusion, journal).reconcilier();
    const vues = messages.flatMap((m) => (m.type === 'session' ? [m.session] : []));
    expect(vues.find((s) => s.id === 'cse_old')?.archivee).toBe(true);
    expect(vues.find((s) => s.id === 's-poste')?.epinglee).toBe(true);
  });

  test('relancer le rapprochement sans changement n’écrit ni ne diffuse rien', () => {
    const { registre, diffusion, messages } = monde();
    const service = new Doublons(registre, diffusion, journal);
    service.reconcilier();
    messages.length = 0;
    service.reconcilier();
    expect(messages).toEqual([]);
    expect(ids(registre.sessions(false))).toEqual(['cse_autre', 's-poste']);
  });

  test('une fiche de poste rangée laisse la jumelle vivante reprendre la place', () => {
    const { registre, diffusion } = monde();
    const service = new Doublons(registre, diffusion, journal);
    service.reconcilier();
    registre.definirArchivee('s-poste', true);
    service.reconcilier();
    expect(ids(registre.sessions(false))).toEqual(['cse_autre', 'cse_new']);
    expect(registre.categories()[0]?.sessions).toEqual(['cse_new', 'cse_autre']);
  });

  test('deux conversations différentes ne sont jamais fusionnées', () => {
    const { registre, diffusion } = monde();
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(registre.session('cse_autre')?.archivee).toBe(false);
  });

  test('réparation au démarrage : un épinglage posé sur une jumelle passe à la fiche de poste', () => {
    const { registre, diffusion } = monde();
    registre.definirEpinglee('cse_new', true);
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(registre.session('s-poste')?.epinglee).toBe(true);
    expect(registre.session('cse_new')?.epinglee).toBe(false);
    expect(registre.session('cse_old')?.epinglee).toBe(false);
  });

  test('une jumelle seule reste l’entrée, épinglée comme avant', () => {
    const { registre, diffusion } = monde();
    registre.definirEpinglee('cse_autre', true);
    new Doublons(registre, diffusion, journal).reconcilier();
    expect(ids(registre.sessions(false))).toContain('cse_autre');
    expect(registre.session('cse_autre')?.epinglee).toBe(true);
  });
});

describe('actions de Chris visant une jumelle : elles portent sur l’entrée principale', () => {
  test('épingler depuis la jumelle épingle la fiche de poste, jamais la jumelle', async () => {
    const { registre, diffusion } = monde();
    const api = new ApiSessions(registre, postesMuets, diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'epingler'));
    expect(ids(registre.sessions(false))).toEqual(['cse_autre', 's-poste']);
    expect(registre.session('s-poste')?.epinglee).toBe(true);
    expect(registre.session('cse_new')?.epinglee).toBe(false);
    expect(registre.session('cse_old')?.epinglee).toBe(false);
  });

  test('désépingler depuis la jumelle désépingle la fiche de poste', async () => {
    const { registre, diffusion } = monde();
    const api = new ApiSessions(registre, postesMuets, diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'epingler'));
    await api.action(requete('cse_new', 'desepingler'));
    expect(registre.session('s-poste')?.epinglee).toBe(false);
    expect(ids(registre.sessions(false))).toEqual(['cse_autre', 's-poste']);
  });

  test('désépingler depuis la fiche de poste est cohérent avec la jumelle', async () => {
    const { registre, diffusion } = monde();
    const api = new ApiSessions(registre, postesMuets, diffusion, new Set(), journal);
    await api.action(requete('s-poste', 'desepingler'));
    expect(registre.session('s-poste')?.epinglee).toBe(false);
    expect(registre.session('cse_old')?.epinglee).toBe(false);
  });

  test('marquer non lue depuis la jumelle marque la fiche de poste', async () => {
    const { registre, diffusion } = monde();
    const api = new ApiSessions(registre, postesMuets, diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'marquer_non_lue'));
    expect(registre.session('s-poste')?.nonLue).toBe(true);
    expect(registre.session('cse_new')?.nonLue).toBe(false);
  });

  test('archiver depuis la jumelle range toute la conversation, et la désarchiver la rend', async () => {
    const { registre, diffusion } = monde();
    const commandes: unknown[] = [];
    const api = new ApiSessions(registre, postesAccepteurs(commandes), diffusion, new Set(), journal);
    await api.action(requete('cse_new', 'archiver'));
    expect(commandes).toEqual([{ kind: 'fermer', sessionId: 's-poste' }]);
    expect(ids(registre.sessions(false))).toEqual(['cse_autre']);
    expect(registre.session('cse_new')?.archivee).toBe(true);
    await api.action(requete('cse_old', 'desarchiver'));
    expect(ids(registre.sessions(false))).toEqual(['cse_autre', 's-poste']);
  });
});
