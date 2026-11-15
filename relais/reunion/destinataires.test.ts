import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { choisirAuto, routerParPertinence, sessionsActives } from './destinataires.ts';

function session(id: string, projet: string, titre: string, extra: Partial<ResumeSession> = {}): ResumeSession {
  const MAJ = '2026-11-15T10:00:00.000Z';
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: `/mnt/${projet}`, nom: projet },
    cwd: `/mnt/${projet}`,
    titre,
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
    ...extra,
  };
}

const ATLAS = session('atlas', 'atlas', 'Refonte du tableau');
const BOREAL = session('boreal', 'boreal', 'Facturation mensuelle');
const CIVIL = session('civil', 'civil', 'Audit sécurité', { statut: 'fermee' });
const RANGEE = session('rangee', 'orion', 'Ancienne piste', { archivee: true });

describe('sessionsActives', () => {
  test('exclut les sessions fermées et rangées', () => {
    expect(sessionsActives([ATLAS, CIVIL, RANGEE, BOREAL]).map((s) => s.id)).toEqual(['atlas', 'boreal']);
  });
});

describe('routerParPertinence', () => {
  test('retient les sessions dont le projet ou le titre est mentionné', () => {
    expect(routerParPertinence('Peux-tu regarder la facturation ?', [ATLAS, BOREAL])).toEqual(['boreal']);
    expect(routerParPertinence('Où en est la Refonte du tableau ?', [ATLAS, BOREAL])).toEqual(['atlas']);
  });

  test('sans mention, toutes les sessions actives', () => {
    expect(routerParPertinence('Bonjour à tous', [ATLAS, BOREAL])).toEqual(['atlas', 'boreal']);
  });

  test('un nom trop court ne compte pas comme une mention', () => {
    const p = session('p', 'p', 'a');
    expect(routerParPertinence('pour a et p', [p, BOREAL])).toEqual(['p', 'boreal']);
  });
});

describe('choisirAuto', () => {
  test('ne rend que des sessions actives, même si le routeur en désigne d autres', () => {
    const routeur = (): readonly string[] => ['civil', 'boreal', 'inconnue'];
    expect(choisirAuto('x', [ATLAS, BOREAL, CIVIL], routeur)).toEqual(['boreal']);
  });

  test('sans routeur fourni, applique le routage par pertinence', () => {
    expect(choisirAuto('facturation', [ATLAS, BOREAL, CIVIL])).toEqual(['boreal']);
  });
});
