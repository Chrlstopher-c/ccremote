/**
 * Restauration du registre (dette n°1, TODO.md) — critère de réussite de la
 * mission : reproduire le scénario de `validation-proprietes/isolation.test.ts`
 * (« isolation — CONDITION : dette n°1 ») et montrer que le candidat entrant est
 * désormais REJETÉ ou ÉVINCÉ, jamais accepté en silence.
 */

import { describe, expect, test } from 'bun:test';
import { arbitrerFencing, type DetenteurEpoch } from './fencing-epoch.ts';
import { PersistanceRegistreSqlite } from './persistance-registre.ts';
import { restaurerRegistre } from './restauration-registre.ts';
import type { WorkerSpec } from '../workers/index.ts';

function specFactice(): WorkerSpec {
  // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
  return {
    sessionId: 'sess-legitime', cwd: '/worktrees/alpha', mandate: 'lead',
    deniedToolPatterns: [], maxBudgetUsd: 25, portAuditPermissions: () => ({}),
  };
}

describe('restaurerRegistre — trois issues, biais asymétrique non négociable', () => {
  test('vivant_confirme : pid présent, starttime identique ⇒ reste vivant', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 3,
      pid: 4242, pidStarttime: '987654', vivant: true, spec: specFactice(),
    });

    const restaures = restaurerRegistre(persistance, { lireStarttime: () => '987654' });

    expect(restaures).toHaveLength(1);
    expect(restaures[0]).toMatchObject({ sessionId: 's1', etat: 'vivant_confirme', vivant: true });
  });

  test('mort_confirme : pid absent du système ⇒ vivant devient false, le worktree se libère', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 3,
      pid: 4242, pidStarttime: '987654', vivant: true, spec: specFactice(),
    });

    const restaures = restaurerRegistre(persistance, { lireStarttime: () => null });

    expect(restaures[0]).toMatchObject({ etat: 'mort_confirme', vivant: false });
  });

  test('☠ mort_confirme : pid recyclé (existe mais starttime différent) ⇒ jamais confondu avec vivant', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 3,
      pid: 4242, pidStarttime: '987654', vivant: true, spec: specFactice(),
    });

    const restaures = restaurerRegistre(persistance, { lireStarttime: () => '000000' });

    expect(restaures[0]).toMatchObject({ etat: 'mort_confirme', vivant: false });
  });

  test('☠ indetermine (pid jamais capturé) ⇒ vivant reste true — NE LIBÈRE JAMAIS le worktree dans le doute', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 3,
      pid: null, pidStarttime: null, vivant: true, spec: specFactice(),
    });

    const restaures = restaurerRegistre(persistance);

    expect(restaures[0]).toMatchObject({ etat: 'indetermine', vivant: true });
  });

  test('une ligne déjà marquée morte avant le redémarrage reste morte, sans revalidation', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 's1', missionId: 'm1', worktree: '/tmp/a', epoch: 3,
      pid: 4242, pidStarttime: '987654', vivant: false, spec: specFactice(),
    });

    let appele = false;
    const restaures = restaurerRegistre(persistance, {
      lireStarttime: () => {
        appele = true;
        return '987654';
      },
    });

    expect(restaures[0]).toMatchObject({ etat: 'mort_confirme', vivant: false });
    expect(appele).toBe(false);
  });
});

describe('Fermeture du scénario M-53 (isolation.test.ts) — la panne est corrigée', () => {
  test('AVANT (référence, comportement documenté) : registre vide après "redémarrage" ⇒ acceptation silencieuse', () => {
    const concurrentsApresRedemarrageSansPersistance: readonly DetenteurEpoch[] = [];
    const decision = arbitrerFencing(concurrentsApresRedemarrageSansPersistance, { sessionId: 'sess-intrus', epoch: 1 });
    expect(decision).toEqual({ type: 'accepte' }); // la panne, telle que M-53 l'a démontrée
  });

  test('APRÈS (cette mission) : le worker légitime persisté et confirmé vivant fait REJETER le candidat de même epoch', () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    // Avant "redémarrage" : sess-legitime détient le worktree "alpha" à l'epoch 3, persisté.
    persistance.sauvegarder({
      sessionId: 'sess-legitime', missionId: 'mission-alpha', worktree: '/worktrees/alpha', epoch: 3,
      pid: 4242, pidStarttime: '987654', vivant: true, spec: specFactice(),
    });

    // "Redémarrage du superviseur PC" : RegistreWorkers en mémoire repart vide, mais
    // restaurerRegistre() relit la persistance et revalide le pid (confirmé vivant).
    const concurrentsRestaures = restaurerRegistre(persistance, { lireStarttime: () => '987654' });
    expect(concurrentsRestaures[0]).toMatchObject({ etat: 'vivant_confirme', vivant: true });

    // Un candidat intrus au MÊME epoch se présente (voir #arbitrerFencingWorktree :
    // concurrents = registre en mémoire [vide] UNION concurrents restaurés).
    const concurrentsVus: DetenteurEpoch[] = concurrentsRestaures
      .filter((c) => c.vivant && c.worktree === '/worktrees/alpha')
      .map((c) => ({ sessionId: c.sessionId, epoch: c.epoch }));
    const decisionCandidatMemeEpoch = arbitrerFencing(concurrentsVus, { sessionId: 'sess-intrus', epoch: 3 });
    expect(decisionCandidatMemeEpoch).toEqual({ type: 'rejete', motif: 'collision_meme_epoch', epochCourant: 3 });

    // Une VRAIE reprise légitime (epoch strictement supérieur, incrémenté par le Pi
    // au rattachement) est acceptée, et le concurrent restauré est listé à évincer —
    // jamais une acceptation muette sans éviction.
    const decisionReprise = arbitrerFencing(concurrentsVus, { sessionId: 'sess-reprise', epoch: 4 });
    expect(decisionReprise).toEqual({ type: 'accepte_evince', sessionsAEvincer: ['sess-legitime'] });
  });
});
