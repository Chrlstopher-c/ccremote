// Responsabilité : tests du cycle de vie d'une session adoptée dans un terminal ordinaire (hors tmux) — ouverte tant
// que son processus vit, fermée quand il disparaît.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { SessionPersistee } from './persistance.ts';
import type { SortieSession } from './session-poste.ts';
import * as tmux from './tmux.ts';
import { SessionTmux } from './session-tmux.ts';

const MAJ = '2026-11-15T10:00:00.000Z';

function fiche(partiel: Partial<ResumeSession>): ResumeSession {
  return {
    id: 'session-terminal',
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: 'Session adoptée',
    objectif: null,
    modele: 'défaut',
    compte: 'principal',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'session-terminal',
    tmux: null,
    attachee: false,
    pilotee: false,
    terminal: true,
    creeLe: MAJ,
    majLe: MAJ,
    ...partiel,
  };
}

function montage(resume: ResumeSession): { session: SessionTmux; emis: ResumeSession[] } {
  const emis: ResumeSession[] = [];
  const sortie: SortieSession = { evenement: () => undefined, resume: (r) => emis.push(r) };
  const persistee: SessionPersistee = {
    resume,
    consignes: null,
    configDir: null,
    transcript: null,
    position: 0,
    aReprendre: false,
  };
  const session = new SessionTmux(persistee, { socket: 'test', journal: pino({ enabled: false }), sortie });
  return { session, emis };
}

describe('session adoptée dans un terminal : cycle de vie', () => {
  test('son processus disparu, elle passe en fermée et ne fume plus', () => {
    const { session, emis } = montage(fiche({ statut: 'attente' }));
    session.rattacherTerminal(false);

    expect(session.resume.statut).toBe('fermee');
    expect(session.resume.terminal).toBe(false);
    expect(emis.at(-1)?.statut).toBe('fermee');
  });

  test('en plein tour, son processus disparu, elle passe aussi en fermée', () => {
    const { session } = montage(fiche({ statut: 'travail' }));
    session.rattacherTerminal(false);

    expect(session.resume.statut).toBe('fermee');
  });

  test('tant que son processus vit, elle reste ouverte', () => {
    const { session } = montage(fiche({ statut: 'attente' }));
    session.rattacherTerminal(true);

    expect(session.resume.statut).toBe('attente');
    expect(session.resume.terminal).toBe(true);
  });

  test('une session fermée dont le processus revient se rouvre', () => {
    const { session } = montage(fiche({ statut: 'fermee', terminal: false }));
    session.rattacherTerminal(true);

    expect(session.resume.statut).toBe('attente');
    expect(session.resume.terminal).toBe(true);
  });

  test('la découverte sans pane tmux ne ferme pas une session dans un terminal', () => {
    const { session } = montage(fiche({ statut: 'attente' }));
    session.rattacher(null);

    expect(session.resume.statut).toBe('attente');
  });
});

describe('titre d une session adoptée dans tmux', () => {
  const pane = (nom: string, titre: string): tmux.PaneTmux => ({
    nom,
    creeLe: 0,
    attachee: false,
    dossier: '/home/x/alpha',
    titre,
    pid: 4242,
  });

  test('un nom par défaut (« alpha-93 », nom cc) ne remplace pas le titre provisoire du dossier', () => {
    const { session, emis } = montage(fiche({ cwd: '/home/x/alpha', titre: 'alpha', terminal: false, tmux: null }));
    session.nommer('alpha-93', null);
    session.rattacher(pane('claude-alpha-93', 'alpha'));

    expect(session.resume.titre).toBe('alpha');
    expect(emis.at(-1)?.titre ?? 'alpha').not.toBe('alpha-93');
  });

  test('un nom donné par Chris (registre cc) devient le titre', () => {
    const { session } = montage(fiche({ cwd: '/home/x/alpha', titre: 'alpha', terminal: false, tmux: null }));
    session.nommer('Migration de la base', null);
    session.rattacher(pane('claude-alpha', 'alpha'));

    expect(session.resume.titre).toBe('Migration de la base');
  });
});
