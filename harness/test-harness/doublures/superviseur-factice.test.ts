// Injecteurs des pannes #2 (pas de fencing par epoch : deux workers sur un
// worktree, sans erreur) et de l'exit nu B.1.5 (crash muet, stderr non rapatrié).

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../deterministe/horloge-simulee.ts';
import { JournalPannes } from '../journal/journal-pannes.ts';
import { OPTIONS_SUPERVISEUR_SAINES, SuperviseurFactice } from './superviseur-factice.ts';
import type { OptionsSuperviseur } from './superviseur-factice.ts';
import { rejouerDeuxFois } from '../rejeu.ts';

const monter = (
  options: Partial<OptionsSuperviseur> = {},
): { superviseur: SuperviseurFactice; journal: JournalPannes } => {
  const journal = new JournalPannes(new HorlogeSimulee());
  const superviseur = new SuperviseurFactice(journal, { ...OPTIONS_SUPERVISEUR_SAINES, ...options });
  return { superviseur, journal };
};

const spawn = (
  superviseur: SuperviseurFactice,
  worktree: string,
  epoch: number,
): ReturnType<SuperviseurFactice['spawner']> =>
  superviseur.spawner({ worktree, sessionId: `s-${worktree}-${epoch}`, epoch });

describe('SuperviseurFactice — inventaire fait autorité (B.1.4)', () => {
  test('un worker spawné apparaît vivant à l’inventaire', () => {
    const { superviseur } = monter();
    const w = spawn(superviseur, 'alpha', 1);
    expect(superviseur.inventaire().map((d) => d.id)).toEqual([w.id]);
  });

  test('un worker arrêté proprement sort de l’inventaire avec exitCode 0', () => {
    const { superviseur, journal } = monter();
    const w = spawn(superviseur, 'alpha', 1);
    superviseur.arreterProprement(w.id);
    expect(superviseur.inventaire()).toHaveLength(0);
    expect(journal.filtrer('worker_mort')[0]?.details.brutal).toBe(false);
  });

  test('deux worktrees distincts cohabitent sans arbitrage', () => {
    const { superviseur, journal } = monter();
    spawn(superviseur, 'alpha', 1);
    spawn(superviseur, 'beta', 1);
    expect(superviseur.inventaire()).toHaveLength(2);
    expect(journal.contient('worker_rejete_epoch_perime')).toBe(false);
  });
});

describe('SuperviseurFactice — panne #2 (fencing par epoch)', () => {
  test('fencing actif : l’epoch supérieur évince le worker périmé', () => {
    const { superviseur, journal } = monter({ fencingEpoch: true });
    const ancien = spawn(superviseur, 'alpha', 1);
    const nouveau = spawn(superviseur, 'alpha', 2);
    expect(superviseur.workersSurWorktree('alpha').map((d) => d.id)).toEqual([nouveau.id]);
    expect(journal.filtrer('worker_rejete_epoch_perime')[0]?.details.id).toBe(ancien.id);
    expect(journal.contient('double_worker_worktree')).toBe(false);
  });

  test('fencing actif : un spawn d’epoch périmé est rejeté, pas l’existant', () => {
    const { superviseur } = monter({ fencingEpoch: true });
    const courant = spawn(superviseur, 'alpha', 5);
    const retardataire = spawn(superviseur, 'alpha', 3);
    expect(retardataire.vivant).toBe(false);
    expect(superviseur.workersSurWorktree('alpha').map((d) => d.id)).toEqual([courant.id]);
  });

  test('fencing actif : deux workers de même epoch ne peuvent coexister', () => {
    const { superviseur } = monter({ fencingEpoch: true });
    spawn(superviseur, 'alpha', 4);
    spawn(superviseur, 'alpha', 4);
    expect(superviseur.workersSurWorktree('alpha')).toHaveLength(1);
  });

  test('fencing désactivé : deux workers vivants sur le worktree, sans erreur', () => {
    const { superviseur, journal } = monter({ fencingEpoch: false });
    spawn(superviseur, 'alpha', 1);
    spawn(superviseur, 'alpha', 2);
    expect(superviseur.workersSurWorktree('alpha')).toHaveLength(2);
    expect(journal.contient('double_worker_worktree')).toBe(true);
    expect(journal.contient('worker_rejete_epoch_perime')).toBe(false);
  });
});

describe('SuperviseurFactice — exit nu (B.1.5)', () => {
  test('stderr rapatrié : la mort brutale laisse une trace lisible', () => {
    const { superviseur, journal } = monter({ stderrRapatrie: true });
    const w = spawn(superviseur, 'alpha', 1);
    superviseur.tuerSansPreavis(w.id);
    expect(superviseur.stderrDe(w.id).length).toBeGreaterThan(0);
    expect(journal.contient('exit_nu')).toBe(false);
  });

  test('stderr non rapatrié : le crash est muet', () => {
    const { superviseur, journal } = monter({ stderrRapatrie: false });
    const w = spawn(superviseur, 'alpha', 1);
    superviseur.tuerSansPreavis(w.id);
    expect(superviseur.stderrDe(w.id)).toHaveLength(0);
    expect(journal.contient('exit_nu')).toBe(true);
    expect(journal.filtrer('worker_mort')[0]?.details.muet).toBe(true);
  });

  test('une mort brutale n’a ni exitCode ni seconde émission', () => {
    const { superviseur, journal } = monter();
    const w = spawn(superviseur, 'alpha', 1);
    superviseur.tuerSansPreavis(w.id);
    superviseur.tuerSansPreavis(w.id);
    expect(journal.compter('worker_mort')).toBe(1);
    expect(superviseur.inventaire()).toHaveLength(0);
  });

  test('configurer bascule le mode en cours de scénario', () => {
    const { superviseur, journal } = monter({ stderrRapatrie: true });
    superviseur.configurer({ stderrRapatrie: false });
    const w = spawn(superviseur, 'alpha', 1);
    superviseur.tuerSansPreavis(w.id);
    expect(journal.contient('exit_nu')).toBe(true);
  });

  test('le scénario complet est reproductible', async () => {
    const { premiere, seconde } = await rejouerDeuxFois(() => {
      const { superviseur, journal } = monter({ fencingEpoch: false, stderrRapatrie: false });
      spawn(superviseur, 'alpha', 1);
      const b = spawn(superviseur, 'alpha', 2);
      superviseur.tuerSansPreavis(b.id);
      return journal.faits();
    });
    expect(premiere).toBe(seconde);
    expect(premiere).toContain('double_worker_worktree');
  });
});
