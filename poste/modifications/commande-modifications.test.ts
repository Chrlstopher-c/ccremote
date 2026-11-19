import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import { ModificationsSessions, estCommandeModifications } from './commande-modifications.ts';
import type { CommandeModifications } from './commande-modifications.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-19T10:00:00.000Z';
let base = '';

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'quart-commande-'));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function session(id: string, cwd: string, moteur: 'sdk' | 'tmux'): { readonly resume: ResumeSession } {
  return {
    resume: {
      id,
      machine: 'tour',
      projet: { machine: 'tour', chemin: cwd, nom: 'p' },
      cwd,
      titre: id,
      objectif: null,
      modele: 'opus',
      compte: 'defaut',
      autonomie: false,
      statut: 'attente',
      contexte: { tokens: 0, max: 1_000_000 },
      etapes: 0,
      compactions: 0,
      claudeSessionId: id,
      moteur,
      tmux: null,
      attachee: false,
      pilotee: true,
      creeLe: MAJ,
      majLe: MAJ,
    },
  };
}

function gestionnaire(): { modifications: ModificationsSessions; evenements: Evenement[] } {
  const evenements: Evenement[] = [];
  const sortie = {
    evenement: (_id: string, evt: Evenement) => {
      evenements.push(evt);
    },
    resume: () => undefined,
  };
  return {
    modifications: new ModificationsSessions({ donnees: join(base, 'donnees'), machine: 'tour', journal, sortie }),
    evenements,
  };
}

describe('commandes de modifications', () => {
  test('reconnaît les commandes git_ et tour_ seulement', () => {
    const diff = { kind: 'tour_diff', id: 'r', sessionId: 's', tour: 'dernier', chemin: 'a' } as const;
    expect(estCommandeModifications(diff)).toBe(true);
    expect(estCommandeModifications({ kind: 'artefacts', id: 'r', sessionId: 's' })).toBe(false);
  });

  test('une session inconnue donne un refus sans rien faire', async () => {
    const { modifications } = gestionnaire();
    const c: CommandeModifications = { kind: 'git_modifications', id: 'r', sessionId: 'absente', portee: 'non_commitees' };
    expect(await modifications.executer(c, undefined)).toEqual({ ok: false, erreur: 'session inconnue sur tour' });
  });

  test('une session tmux n’a pas de tours : « tour inconnu »', async () => {
    const { modifications } = gestionnaire();
    const dossier = mkdtempSync(join(base, 'tmux-'));
    const c: CommandeModifications = { kind: 'tour_modifications', id: 'r', sessionId: 't', tour: 'dernier' };
    expect(await modifications.executer(c, session('t', dossier, 'tmux'))).toEqual({
      ok: false,
      erreur: 'tour inconnu',
    });
  });

  test('annuler le dernier tour rend son identifiant réel et publie `tour_annule`', async () => {
    const { modifications, evenements } = gestionnaire();
    const dossier = mkdtempSync(join(base, 'sdk-'));
    const s = session('s1', dossier, 'sdk');
    const fichier = join(dossier, 'a.txt');
    writeFileSync(fichier, 'avant\n');
    const tours = modifications.toursDe('s1', dossier);
    tours.noterAvant(fichier);
    writeFileSync(fichier, 'après\n');
    const fin = tours.finirTour();
    const reponse = await modifications.executer(
      { kind: 'tour_annuler', id: 'r', sessionId: 's1', tour: 'dernier' },
      s,
    );
    expect(reponse).toMatchObject({ ok: true, donnees: { fichiers: 1, tour: fin?.tour } });
    expect(evenements).toEqual([{ type: 'tour_annule', tour: fin?.tour ?? '' }]);
  });

  test('un refus d’annulation ne publie rien', async () => {
    const { modifications, evenements } = gestionnaire();
    const dossier = mkdtempSync(join(base, 'refus-'));
    const fichier = join(dossier, 'a.txt');
    writeFileSync(fichier, 'avant\n');
    const tours = modifications.toursDe('s2', dossier);
    tours.noterAvant(fichier);
    writeFileSync(fichier, 'après\n');
    tours.finirTour();
    writeFileSync(fichier, 'ailleurs\n');
    const reponse = await modifications.executer(
      { kind: 'tour_annuler', id: 'r', sessionId: 's2', tour: 'dernier' },
      session('s2', dossier, 'sdk'),
    );
    expect(reponse).toEqual({ ok: false, erreur: 'modifié depuis la fin du tour : a.txt' });
    expect(evenements).toEqual([]);
  });
});
