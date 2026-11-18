// Responsabilité : tests du relais côté postes — à chaque bonjour, les sessions absentes de l’annonce sont fermées.
// La mise à jour est diffusée comme les autres changements de session.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from './postes.ts';

const MAJ = '2026-11-15T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string, machine: string, statut: ResumeSession['statut']): ResumeSession {
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
    statut,
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

// Seuls `data.machine` (relais) et `send` (diffusion) sont lus sur ces faux sockets.
function fauxPoste(machine: string): ServerWebSocket<DonneesPoste> {
  return { data: { machine } } as unknown as ServerWebSocket<DonneesPoste>;
}

function clientEcoute(): { ws: ServerWebSocket<unknown>; recus: MessageClient[] } {
  const recus: MessageClient[] = [];
  const ws = {
    send: (texte: string) => recus.push(JSON.parse(texte) as MessageClient),
  } as unknown as ServerWebSocket<unknown>;
  return { ws, recus };
}

function montage(sessionsInitiales: ResumeSession[]): {
  postes: Postes;
  registre: Registre;
  recus: MessageClient[];
} {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  for (const s of sessionsInitiales) registre.enregistrerSession(s);
  const diffusion = new Diffusion();
  const { ws, recus } = clientEcoute();
  diffusion.ajouter(ws);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  return { postes, registre, recus };
}

function bonjour(machine: string, annoncees: ResumeSession[]): string {
  return JSON.stringify({
    kind: 'bonjour',
    version: 'test',
    description: machine,
    racines: [],
    projets: [],
    comptes: ['defaut'],
    sessions: annoncees,
  });
}

function messagesSession(recus: MessageClient[], id: string): ResumeSession[] {
  return recus.flatMap((m) => (m.type === 'session' && m.session.id === id ? [m.session] : []));
}

describe('bonjour : sessions absentes de l’annonce du poste', () => {
  test('une session de la machine que le poste n’annonce plus passe en fermée, et la mise à jour est diffusée', () => {
    const { postes, registre, recus } = montage([
      session('annoncee', 'tour', 'attente'),
      session('disparue', 'tour', 'attente'),
      session('autre-machine', 'portable', 'travail'),
    ]);
    postes.recu(fauxPoste('tour'), bonjour('tour', [session('annoncee', 'tour', 'attente')]));

    expect(registre.session('disparue')?.statut).toBe('fermee');
    expect(messagesSession(recus, 'disparue').map((s) => s.statut)).toEqual(['fermee']);
    expect(registre.session('annoncee')?.statut).toBe('attente');
    expect(registre.session('autre-machine')?.statut).toBe('travail');
  });

  test('une session déjà fermée et absente de l’annonce n’est pas rediffusée', () => {
    const { postes, recus } = montage([session('deja-fermee', 'tour', 'fermee')]);
    postes.recu(fauxPoste('tour'), bonjour('tour', []));

    expect(messagesSession(recus, 'deja-fermee')).toEqual([]);
  });

  test('une annonce vide ferme toutes les sessions non fermées de la machine', () => {
    const { postes, registre } = montage([
      session('a', 'tour', 'travail'),
      session('b', 'tour', 'attente'),
      session('c', 'tour', 'erreur'),
    ]);
    postes.recu(fauxPoste('tour'), bonjour('tour', []));

    expect(['a', 'b', 'c'].map((id) => registre.session(id)?.statut)).toEqual(['fermee', 'fermee', 'fermee']);
  });
});

describe('flux : deltas de texte relayés sans persistance', () => {
  test('un delta est diffusé tel quel, n’entre pas dans le fil et ne fait pas avancer le long-poll', () => {
    const { postes, registre, recus } = montage([session('s', 'tour', 'travail')]);
    const versionAvant = registre.derniersEvenements('s', 300).length;
    postes.recu(
      fauxPoste('tour'),
      JSON.stringify({ kind: 'flux', sessionId: 's', bloc: 'm:0', delta: 'Sal', genre: 'reflexion' }),
    );

    expect(recus).toEqual([{ type: 'flux', sessionId: 's', bloc: 'm:0', delta: 'Sal', genre: 'reflexion' }]);
    expect(registre.derniersEvenements('s', 300)).toHaveLength(versionAvant);
  });

  test('un delta de sous-agent porte son auteur, pour que le client ne le mêle pas au fil principal', () => {
    const { postes, recus } = montage([session('s', 'tour', 'travail')]);
    postes.recu(
      fauxPoste('tour'),
      JSON.stringify({ kind: 'flux', sessionId: 's', bloc: 'm:0', delta: 'x', agent: 'toolu_1' }),
    );

    expect(recus).toEqual([{ type: 'flux', sessionId: 's', bloc: 'm:0', delta: 'x', agent: 'toolu_1' }]);
  });

  test('un delta d’une session d’une autre machine est ignoré', () => {
    const { postes, recus } = montage([session('s', 'portable', 'travail')]);
    postes.recu(fauxPoste('tour'), JSON.stringify({ kind: 'flux', sessionId: 's', bloc: 'm:0', delta: 'x' }));

    expect(recus).toEqual([]);
  });
});
