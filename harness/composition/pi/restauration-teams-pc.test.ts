import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import { revendicationsEnVeilleDepuisTeams } from '../../control-plane/orchestrateur/restauration-teams-worktrees.ts';
import {
  GestionnaireCycleVieWorktree,
  type ConfigProjet,
  type GestionnaireWorktreeGit,
  type InterrogateurGit,
  type RevendicationEnVeilleRestauree,
} from '../../projets/index.ts';
import { CanalControle, type PortSuperviseurControle } from '../../superviseur/index.ts';

/** Config git minimale pour `allouer` (seuls estGit/brancheDefaut/cheminDepot/id sont lus). */
function configGit(cheminDepot: string): ConfigProjet {
  return {
    id: cheminDepot,
    cheminDepot,
    estGit: true,
    brancheDefaut: 'main',
    budgetMaxUsd: 0,
    modeleDefaut: '',
    deniedToolPatternsSupplementaires: [],
    agentTeamsActif: false,
    mandatType: 'standard',
    domainesEquipe: [],
    isolationGarantie: true,
    fichierSource: '(test)',
  };
}

describe('Restauration Pi→PC des worktrees en veille (branchement #2)', () => {
  let registre: Registre;
  beforeEach(() => {
    registre = ouvrirRegistre({ chemin: ':memory:' });
  });
  afterEach(() => registre.fermer());

  test('☠ chaîne complète : team dormante → projection → réamorçage → réveil SANS git worktree add', async () => {
    // Le Pi porte une team dormante avec un worktree persistant sur disque.
    registre.teams.creer(
      { id: 'team-1', projet: '/mnt/projects/vela', domaine: 'frontend', worktree: '/wt/team-1', branche: 'equipe/team-1' },
      100,
    );
    const revs = revendicationsEnVeilleDepuisTeams(registre);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ idEquipe: 'team-1', worktreePath: '/wt/team-1' });

    // Côté PC : un gestionnaire NEUF (Map vide, comme après un redémarrage).
    const creerAppels: string[] = [];
    const gestionnaireGit: GestionnaireWorktreeGit = {
      creer: async (_depot, worktreePath): Promise<void> => {
        creerAppels.push(worktreePath);
      },
      supprimer: async (): Promise<void> => {},
    };
    const interrogateur: InterrogateurGit = {
      estDepotGit: async () => true,
      existeBranche: async () => true,
      aTravailNonCommite: async () => false,
    };
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire: gestionnaireGit });

    // Réamorçage depuis la projection du Pi.
    for (const rev of revs) cycle.restaurerRevendicationEnVeille(rev);
    expect(cycle.revendicationDe('team-1')?.etat).toBe('en_veille');

    // Réveil : un dispatch réel porte un epoch strictement supérieur (≥ 1).
    const revendication = await cycle.allouer({
      projet: configGit('/mnt/projects/vela'),
      idEquipe: 'team-1',
      epoch: 5,
      racineWorktrees: '/wt',
    });

    // Le worktree persistant est RÉUTILISÉ : aucun `git worktree add`.
    expect(creerAppels).toEqual([]);
    expect(revendication.worktreePath).toBe('/wt/team-1');
    expect(revendication.etat).toBe('revendiquee');
  });
});

describe('Canal de contrôle — opération restaurer_revendications_veille (transport #2)', () => {
  const revsExemple: readonly RevendicationEnVeilleRestauree[] = [
    { idEquipe: 'team-1', projetId: '/p', cheminDepot: '/p', worktreePath: '/wt/team-1', brancheDediee: 'equipe/team-1' },
  ];

  function portMinimal(over: Partial<PortSuperviseurControle> = {}): PortSuperviseurControle {
    return {
      inventaire: () => [],
      demarrer: async () => ({ sessionId: 's' }),
      arreter: async () => {},
      tuerSansPreavis: () => {},
      relancer: async () => ({ dejaVivant: false }),
      reinitialiser: async () => ({ demandesEnAttente: [] }),
      ...over,
    };
  }

  test('☠ l’opération route les revendications vers le port du superviseur', async () => {
    const recues: readonly RevendicationEnVeilleRestauree[][] = [];
    const port = portMinimal({
      restaurerRevendicationsEnVeille: (revs) => {
        (recues as RevendicationEnVeilleRestauree[][]).push([...revs]);
      },
    });
    const canal = new CanalControle(port);
    const reponse = await canal.traiter({
      opId: 'op-1',
      operation: { type: 'restaurer_revendications_veille', revendications: revsExemple },
    });
    expect(reponse.ok).toBe(true);
    expect(recues).toHaveLength(1);
    expect(recues[0]?.[0]?.idEquipe).toBe('team-1');
  });

  test('superviseur sans la méthode → REFUS explicite, jamais un faux succès', async () => {
    const canal = new CanalControle(portMinimal());
    const reponse = await canal.traiter({
      opId: 'op-2',
      operation: { type: 'restaurer_revendications_veille', revendications: revsExemple },
    });
    expect(reponse.ok).toBe(false);
    expect(reponse.effet).toBe('refuse');
  });
});
