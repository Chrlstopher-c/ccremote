import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { reconcilier, type DependancesReconciliation, type DescripteurWorkerPc } from '../reconciliation/index.ts';
import { finaliserActivationsTerminees } from './finalisation-activations-teams.ts';
import type { DependancesFinActivation } from './fin-activation-team.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
  registre.lots.creer({ id: 'lot-1', intention: 'activation' });
});

afterEach(() => registre.fermer());

/** Sème une team ACTIVE + sa mission (activation) `en_cours`, avec un sessionId réel. */
function semerActivation(): { teamId: string; missionId: string; sessionId: string } {
  const sessionId = 'sess-1';
  registre.teams.creer({ id: 'team-1', projet: 'vela', domaine: 'frontend' }, 100);
  registre.teams.activer('team-1', { worktree: '/wt/team-1', branche: 'equipe/team-1' }, 100);
  const mission = registre.missions.creer({
    id: 'm-1',
    lotId: 'lot-1',
    nom: 'activation',
    projet: 'vela',
    compteId: 'compte-a',
    sessionId,
    teamId: 'team-1',
    worktree: '/wt/team-1',
  });
  registre.etats.appliquerEtatHarness(mission.id, 'en_cours');
  return { teamId: 'team-1', missionId: mission.id, sessionId };
}

/** Réconciliation pilotée par un inventaire PC injecté (worker vivant ou mort). */
function depsReconciliation(worker: DescripteurWorkerPc): DependancesReconciliation {
  return {
    inventairePc: {
      inventaire: (): readonly DescripteurWorkerPc[] => [worker],
      tuerSansPreavis: async (): Promise<void> => {},
    },
    // `periodique` ne l'appelle jamais (voir reconciliation.ts) — stub suffisant.
    reinitialisateur: { reinitialiser: async () => ({ demandesEnAttente: [] }) },
  };
}

function depsFin(conserves: string[]): DependancesFinActivation {
  return {
    registre,
    conserverWorktreeTeam: async (m: string): Promise<void> => {
      conserves.push(m);
    },
    fenetreAutonomieActive: () => false,
    redispatcher: async () => ({ missionId: null, detail: '' }),
  };
}

describe('finaliserActivationsTerminees — LE piège central : mort constatée vs running→idle', () => {
  test('☠ WORKER VIVANT (idle, fin de tour) → AUCUNE finalisation, la team RESTE ACTIVE', async () => {
    const { teamId, sessionId } = semerActivation();
    // Le PC rapporte le worker VIVANT : c'est une respiration (idle), pas une mort.
    const rapport = await reconcilier(
      registre,
      depsReconciliation({ sessionId, worktree: '/wt/team-1', epoch: 1, vivant: true }),
      'periodique',
    );
    // Une équipe vivante ne devient JAMAIS fantôme : rien à finaliser.
    expect(rapport.fantomes).toEqual([]);
    const conserves: string[] = [];
    await finaliserActivationsTerminees(depsFin(conserves), rapport.fantomes);
    // La team ne s'endort pas à chaque tour : elle reste ACTIVE.
    expect(registre.teams.lire(teamId)?.etat).toBe('active');
    expect(conserves).toEqual([]);
  });

  test('☠ WORKER MORT (mort constatée) → team ENDORMIE et worktree CONSERVÉ', async () => {
    const { teamId, missionId, sessionId } = semerActivation();
    // Le PC ne voit plus le worker vivant : mort constatée → fantôme → état terminal.
    const rapport = await reconcilier(
      registre,
      depsReconciliation({ sessionId, worktree: '/wt/team-1', epoch: 1, vivant: false }),
      'periodique',
    );
    expect(rapport.fantomes).toContain(missionId);
    const conserves: string[] = [];
    await finaliserActivationsTerminees(depsFin(conserves), rapport.fantomes);
    // C'est ICI, et seulement ici, que la team s'endort.
    expect(registre.teams.lire(teamId)?.etat).toBe('dormante');
    expect(conserves).toEqual([missionId]);
  });

  test('une exception sur une mission ne bloque pas la finalisation des autres', async () => {
    const { teamId } = semerActivation();
    const deps: DependancesFinActivation = {
      registre,
      conserverWorktreeTeam: async () => {
        throw new Error('PC injoignable');
      },
      fenetreAutonomieActive: () => false,
      redispatcher: async () => ({ missionId: null, detail: '' }),
    };
    // La conservation lève, mais la team est quand même endormie (best-effort côté worktree).
    await finaliserActivationsTerminees(deps, ['m-1']);
    expect(registre.teams.lire(teamId)?.etat).toBe('dormante');
  });
});
