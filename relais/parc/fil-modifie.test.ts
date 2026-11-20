// Responsabilité : signal `fil_modifie` diffusé aux clients quand le fil d'une session change sans qu'un événement en
// queue le montre (comblement au milieu, remplacement, recalage qui retire des lignes). Jamais pour un ajout en queue,
// déjà diffusé ligne à ligne.
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

describe('signal fil_modifie : fil changé sans ajout en queue', () => {
  test('un lot qui comble un trou au milieu du fil diffuse le signal, une fois', () => {
    const m = filAvecRelectureComplete();
    envoyer(m, {
      kind: 'historique',
      sessionId: 's',
      replay: 'r1',
      evenements: [
        { ts: T(1), evt: msg('a', 'a') },
        { ts: T(2), evt: msg('b', 'b') },
        { ts: T(3), evt: msg('c', 'c') },
      ],
    });
    expect(textes(m.registre)).toEqual(['a', 'b', 'c']);
    expect(signaux(m)).toEqual([{ type: 'fil_modifie', sessionId: 's' }]);
  });

  test('un remplacement du fil désynchronisé diffuse le signal', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.registre.ajouterEvenement('s', T(9), msg('neuf', 'n'));
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    m.sortie.length = 0;
    envoyer(m, {
      kind: 'historique',
      sessionId: 's',
      replay: 'r1',
      evenements: [
        { ts: T(1), evt: msg('un', 'a') },
        { ts: T(10), evt: msg('dix', 'x') },
      ],
    });
    expect(textes(m.registre)).toEqual(['un', 'dix']);
    expect(signaux(m)).toHaveLength(1);
  });

  test('un recalage qui retire des lignes du fil diffuse le signal', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.registre.ajouterEvenement('s', T(1), msg('un', 'a'));
    m.registre.ajouterEvenement('s', T(1), msg('un', 'a'));
    m.sortie.length = 0;
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    expect(textes(m.registre)).toEqual(['un']);
    expect(signaux(m)).toHaveLength(1);
  });
});

describe('signal fil_modifie : ajout en queue déjà diffusé, pas de signal', () => {
  test('un lot complet qui ne fait que prolonger la queue diffuse ses lignes, sans signal', () => {
    const m = filAvecRelectureComplete();
    envoyer(m, {
      kind: 'historique',
      sessionId: 's',
      replay: 'r1',
      evenements: [
        { ts: T(1), evt: msg('a', 'a') },
        { ts: T(3), evt: msg('c', 'c') },
        { ts: T(4), evt: msg('d', 'd') },
      ],
    });
    expect(textes(m.registre)).toEqual(['a', 'c', 'd']);
    expect(evenements(m)).toHaveLength(1);
    expect(signaux(m)).toHaveLength(0);
  });

  test('un événement ajouté en direct en queue n’émet qu’un événement, sans signal', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.sortie.length = 0;
    envoyer(m, { kind: 'evenement', sessionId: 's', ts: T(1), evt: msg('direct', 'x') });
    expect(evenements(m)).toHaveLength(1);
    expect(signaux(m)).toHaveLength(0);
  });

  test('une suite relue au-delà de l’ancre du fil s’ajoute en queue, sans signal', () => {
    const m = montage();
    envoyer(m, { kind: 'session', session: session('s') });
    m.registre.ajouterEvenement('s', T(1), msg('a', 'a'));
    envoyer(m, { kind: 'recalage', sessionId: 's', archiver: false });
    m.sortie.length = 0;
    envoyer(m, {
      kind: 'historique',
      sessionId: 's',
      replay: 'r1',
      evenements: [
        { ts: T(1), evt: msg('a', 'a') },
        { ts: T(2), evt: msg('b', 'b') },
      ],
    });
    expect(textes(m.registre)).toEqual(['a', 'b']);
    expect(signaux(m)).toHaveLength(0);
  });
});
