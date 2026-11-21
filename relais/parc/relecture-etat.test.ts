// Responsabilité : une relecture d'historique ne passe jamais une session « terminée » ni non lue (fin de tour relue :
// carte au fil, signal de relecture) ; une suite écrite en direct garde l'effet de la fin de tour.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from './postes.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-20T10:00:00.000Z';
const T = (n: number): string => `2026-11-20T10:${String(n).padStart(2, '0')}:00.000Z`;
const msg = (texte: string, uuid?: string): Evenement =>
  uuid ? { type: 'message', texte, uuid } : { type: 'message', texte };

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
    statut: 'fermee',
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

interface Montage {
  readonly postes: Postes;
  readonly registre: Registre;
  readonly poste: ServerWebSocket<DonneesPoste>;
  readonly sortie: Record<string, unknown>[];
}

// Un client connecté voit chaque message sortant ; un poste « tour » envoie ses trames comme sur la liaison réelle.
function montage(): Montage {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const diffusion = new Diffusion();
  const sortie: Record<string, unknown>[] = [];
  diffusion.ajouter({
    send: (texte: string) => sortie.push(JSON.parse(texte) as Record<string, unknown>),
  } as unknown as ServerWebSocket<unknown>);
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  const poste = {
    data: { machine: 'tour' },
    send: () => undefined,
    close: () => undefined,
  } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(poste);
  return { postes, registre, poste, sortie };
}

function envoyer(m: Montage, message: object): void {
  m.postes.recu(m.poste, JSON.stringify(message));
}

const signaux = (m: Montage): Record<string, unknown>[] => m.sortie.filter((x) => x.type === 'fil_modifie');
const evenements = (m: Montage): Record<string, unknown>[] => m.sortie.filter((x) => x.type === 'evenement');

function textes(registre: Registre, id = 's'): string[] {
  return registre
    .derniersEvenements(id, 1000)
    .map((e) => (e.evt.type === 'message' || e.evt.type === 'texte' ? e.evt.texte : e.evt.type));
}

// Fil de trois messages, relecture complète demandée par un recalage (sans lignes à retirer).
function filAvecRelectureComplete(): Montage {
  const m = montage();
  envoyer(m, { kind: 'session', session: session('s') });
  m.registre.ajouterEvenement('s', T(1), msg('a', 'a'));
  m.registre.ajouterEvenement('s', T(3), msg('c', 'c'));
  envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
  m.sortie.length = 0;
  return m;
}

describe('relecture d’historique : fin de tour relue sans effet d’état', () => {
  const FIN: Evenement = { type: 'tour_fini', dureeMs: 1000, contexte: 10, uuid: 'u1' };
  const LOT = [
    { ts: T(0), evt: msg('avant', 'avant') },
    { ts: T(1), evt: msg('a', 'a') },
    { ts: T(2), evt: FIN },
  ];

  // Fil d'un message, relecture complète demandée par un recalage : la relecture qui suit comble la suite.
  function filRecale(): Montage {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.registre.ajouterEvenement('s', T(0), msg('avant', 'avant'));
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    m.sortie.length = 0;
    return m;
  }

  test('une relecture : la fin de tour rejoint le fil, n’est pas diffusée comme événement, le fil est relu', () => {
    const m = filRecale();
    envoyer(m, { kind: 'historique', sessionId: 's', replay: 'r1', evenements: LOT });
    expect(m.registre.derniersEvenements('s', 10).map((e) => e.evt.type)).toEqual(['message', 'message', 'tour_fini']);
    expect(evenements(m).map((x) => (x.evenement as { evt: Evenement }).evt.type)).toEqual(['message']);
    expect(signaux(m)).toEqual([{ type: 'fil_modifie', sessionId: 's' }]);
  });

  test('une suite écrite en direct : la fin de tour est diffusée comme événement', () => {
    const m = filRecale();
    envoyer(m, { kind: 'historique', sessionId: 's', replay: 'r2', direct: true, evenements: LOT });
    const diffusees = evenements(m).map((x) => (x.evenement as { evt: Evenement }).evt.type);
    expect(diffusees).toContain('tour_fini');
  });
});
