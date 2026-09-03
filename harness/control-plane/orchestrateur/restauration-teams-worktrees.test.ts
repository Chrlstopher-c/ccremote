import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { revendicationsEnVeilleDepuisTeams } from './restauration-teams-worktrees.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
});

afterEach(() => registre.fermer());

describe('revendicationsEnVeilleDepuisTeams — projection de la table team (axe B, restauration PC)', () => {
  test('☠ ne rend QUE les teams dormantes PORTEUSES d’un worktree', () => {
    // Dormante AVEC worktree → restaurable.
    registre.teams.creer({ id: 'dorm-wt', projet: '/mnt/projects/vela', domaine: 'frontend' }, 100);
    registre.teams.activer('dorm-wt', { worktree: '/wt/dorm-wt', branche: 'equipe/dorm-wt' }, 100);
    registre.teams.endormir('dorm-wt', 200);

    // Active → exclue (un worker vit dessus, restauré par une autre voie).
    registre.teams.creer({ id: 'act', projet: '/mnt/projects/vela', domaine: 'backend' }, 100);
    registre.teams.activer('act', { worktree: '/wt/act', branche: 'equipe/act' }, 100);

    // Dormante SANS worktree → exclue (rien à réamorçer).
    registre.teams.creer({ id: 'dorm-sans', projet: '/mnt/projects/agora', domaine: 'frontend' }, 100);

    // Démantelée → exclue (worktree libéré).
    registre.teams.creer({ id: 'dem', projet: '/mnt/projects/nullnode', domaine: 'frontend' }, 100);
    registre.teams.activer('dem', { worktree: '/wt/dem', branche: 'equipe/dem' }, 100);
    registre.teams.demanteler('dem', 300);

    const revendications = revendicationsEnVeilleDepuisTeams(registre);
    expect(revendications).toHaveLength(1);
    expect(revendications[0]).toEqual({
      idEquipe: 'dorm-wt',
      projetId: '/mnt/projects/vela',
      cheminDepot: '/mnt/projects/vela',
      worktreePath: '/wt/dorm-wt',
      brancheDediee: 'equipe/dorm-wt',
    });
  });

  test('aucune team dormante avec worktree → liste vide (rien à restaurer)', () => {
    expect(revendicationsEnVeilleDepuisTeams(registre)).toEqual([]);
  });
});
