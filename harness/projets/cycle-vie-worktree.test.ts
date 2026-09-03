/**
 * Tests de `GestionnaireCycleVieWorktree` (F.2).
 *
 * Les deux pannes numérotées dont cette mission répond dans `15-grille-revue.md` :
 * - #10 « association worktree enregistrée après le spawn » ;
 * - #9  « worktree supprimé avec travail non commité ».
 *
 * Doublures en mémoire uniquement (`git-projet-factice.ts`) — aucune commande
 * git réelle exécutée dans cette mission.
 */

import { describe, expect, test } from 'bun:test';
import {
  AucuneRevendicationActiveError,
  EpochNonCroissantError,
  GestionnaireCycleVieWorktree,
  WorktreeDejaRevendiqueeError,
} from './cycle-vie-worktree.ts';
import { GestionnaireWorktreeGitFactice, InterrogateurGitFactice } from './git-projet-factice.ts';
import type { ConfigProjet } from './types.ts';

const RACINE_WORKTREES = '/tmp/racine-worktrees-fictive';

function projetGit(surcharge: Partial<ConfigProjet> = {}): ConfigProjet {
  return {
    id: 'projet-alpha',
    cheminDepot: '/depot/alpha',
    estGit: true,
    brancheDefaut: 'main',
    budgetMaxUsd: 40,
    modeleDefaut: 'sonnet',
    deniedToolPatternsSupplementaires: [],
    agentTeamsActif: false,
    mandatType: 'standard',
    domainesEquipe: [],
    isolationGarantie: true,
    fichierSource: 'alpha.json',
    ...surcharge,
  };
}

function projetNonGit(): ConfigProjet {
  return projetGit({ estGit: false, brancheDefaut: null, isolationGarantie: false });
}

describe('allouer — F.2.1, enregistrement avant tout usage du chemin (panne #10)', () => {
  test('la revendication existe déjà quand le chemin est rendu', async () => {
    const interrogateur = new InterrogateurGitFactice();
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire });

    const revendication = await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    // Le chemin rendu à l'appelant est déjà associé dans le registre interne :
    // il n'existe aucune façon d'obtenir `worktreePath` sans cette association.
    expect(cycle.revendicationDe('equipe-1')).toEqual(revendication);
    expect(gestionnaire.appelsCreer).toHaveLength(1);
    expect(gestionnaire.appelsCreer[0]?.depuisBranche).toBe('main');
    expect(revendication.worktreePath).toContain('equipe-1');
    expect(revendication.brancheDediee).toBe('equipe/equipe-1');
    expect(revendication.etat).toBe('revendiquee');
  });

  test('un échec de création du worktree ne laisse AUCUNE revendication enregistrée', async () => {
    const interrogateur = new InterrogateurGitFactice();
    const gestionnaire = new GestionnaireWorktreeGitFactice(true);
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire });

    await expect(
      cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES }),
    ).rejects.toThrow('git worktree add a échoué');

    expect(cycle.revendicationDe('equipe-1')).toBeUndefined();
    expect(cycle.revendicationsActives()).toEqual([]);
  });

  test('une deuxième allocation pour la même équipe déjà revendiquée est refusée (F.2.1, point 1)', async () => {
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    await expect(cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 2, racineWorktrees: RACINE_WORKTREES })).rejects.toThrow(
      WorktreeDejaRevendiqueeError,
    );
  });

  test('après libération, une nouvelle allocation pour la même équipe est acceptée', async () => {
    const interrogateur = new InterrogateurGitFactice({ sale: false });
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });
    await cycle.liberer('equipe-1');

    const seconde = await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 2, racineWorktrees: RACINE_WORKTREES });
    expect(seconde.etat).toBe('revendiquee');
    expect(gestionnaire.appelsCreer).toHaveLength(2);
  });
});

describe('allouer — D.2.3 fencing (mission M-11, panne #2) : epoch non croissant refusé', () => {
  test('deuxième allocation au MÊME epoch qu’une revendication encore active : rejetée par le fencing, pas par « déjà revendiquée »', async () => {
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    // ☠ Piège déjà payé : l'égalité n'est PAS une reprise légitime, même face à
    // une revendication encore vivante — elle est traitée avant le contrôle d'état.
    await expect(
      cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES }),
    ).rejects.toThrow(EpochNonCroissantError);
  });

  test('epoch inférieur à une revendication active : rejetée par le fencing', async () => {
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 5, racineWorktrees: RACINE_WORKTREES });

    await expect(
      cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 2, racineWorktrees: RACINE_WORKTREES }),
    ).rejects.toThrow(EpochNonCroissantError);
  });

  test('epoch strictement supérieur mais revendication encore active : refusée quand même, par « déjà revendiquée »', async () => {
    // Distinction structurante : cette mission (F.2.2) ne supersède JAMAIS une
    // revendication active — seul le superviseur (branche B) décide qui meurt.
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    await expect(
      cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 2, racineWorktrees: RACINE_WORKTREES }),
    ).rejects.toThrow(WorktreeDejaRevendiqueeError);
  });

  test('après libération, un epoch REJOUÉ (identique à l’ancien) est refusé — pas une reprise légitime', async () => {
    const interrogateur = new InterrogateurGitFactice({ sale: false });
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire: new GestionnaireWorktreeGitFactice() });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });
    await cycle.liberer('equipe-1');

    await expect(
      cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES }),
    ).rejects.toThrow(EpochNonCroissantError);
  });

  test('après libération, un epoch inférieur au dernier connu est refusé', async () => {
    const interrogateur = new InterrogateurGitFactice({ sale: false });
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire: new GestionnaireWorktreeGitFactice() });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 5, racineWorktrees: RACINE_WORKTREES });
    await cycle.liberer('equipe-1');

    await expect(
      cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 3, racineWorktrees: RACINE_WORKTREES }),
    ).rejects.toThrow(EpochNonCroissantError);
  });

  test('premier rattachement pour une équipe encore jamais vue : jamais bloqué, quel que soit l’epoch', async () => {
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    const revendication = await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-jamais-vue', epoch: 0, racineWorktrees: RACINE_WORKTREES });
    expect(revendication.etat).toBe('revendiquee');
  });
});

describe('allouer — F.1.3, mode dégradé projet non-git', () => {
  test('aucun worktree git créé, isolation non garantie, signalée', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire });

    const revendication = await cycle.allouer({ projet: projetNonGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    expect(gestionnaire.appelsCreer).toEqual([]);
    expect(revendication.isolationGarantie).toBe(false);
    expect(revendication.brancheDediee).toBeNull();
    expect(revendication.worktreePath).toBe('/depot/alpha');
  });
});

describe('liberer — F.2.3, jamais de suppression avec travail non commité (panne #9)', () => {
  test('travail non commité ⇒ worktree conservé, `supprimer` jamais appelé', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice({ sale: true }), gestionnaire });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    const resultat = await cycle.liberer('equipe-1');

    expect(resultat.etat).toBe('terminee_non_liberee');
    expect(gestionnaire.appelsSupprimer).toEqual([]);
    // La revendication reste consultable — pas d'oubli silencieux (utile à la réconciliation, hors périmètre ici).
    expect(cycle.revendicationDe('equipe-1')?.etat).toBe('terminee_non_liberee');
  });

  test('travail propre ⇒ suppression effective, revendication libérée', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice({ sale: false }), gestionnaire });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    const resultat = await cycle.liberer('equipe-1');

    expect(resultat.etat).toBe('liberee');
    expect(resultat.libereeA).not.toBeNull();
    expect(gestionnaire.appelsSupprimer).toHaveLength(1);
  });

  test('échec de la vérification git ⇒ pire cas sûr, AUCUNE suppression', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice({ leveErreur: true }), gestionnaire });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    await expect(cycle.liberer('equipe-1')).rejects.toThrow('git status a échoué');
    expect(gestionnaire.appelsSupprimer).toEqual([]);
    // ☠ La revendication doit rester active : un échec de vérification ne doit
    // jamais faire glisser silencieusement l'état vers "libérée".
    expect(cycle.revendicationDe('equipe-1')?.etat).toBe('revendiquee');
  });

  test('projet non-git : libération sans vérification git, jamais de tentative de suppression', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const interrogateur = new InterrogateurGitFactice({ leveErreur: true });
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire });
    await cycle.allouer({ projet: projetNonGit(), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    const resultat = await cycle.liberer('equipe-1');
    expect(resultat.etat).toBe('liberee');
    expect(gestionnaire.appelsSupprimer).toEqual([]);
  });

  test('libérer une équipe sans revendication active lève une erreur explicite', async () => {
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    await expect(cycle.liberer('fantome')).rejects.toThrow(AucuneRevendicationActiveError);
  });
});

describe('revendicationsActives — vue F.2 pour le registre', () => {
  test('ne liste que les revendications à l’état `revendiquee`', async () => {
    const cycle = new GestionnaireCycleVieWorktree({
      interrogateur: new InterrogateurGitFactice({ sale: false }),
      gestionnaire: new GestionnaireWorktreeGitFactice(),
    });
    await cycle.allouer({ projet: projetGit({ id: 'p1' }), idEquipe: 'equipe-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });
    await cycle.allouer({ projet: projetGit({ id: 'p2' }), idEquipe: 'equipe-2', epoch: 1, racineWorktrees: RACINE_WORKTREES });
    await cycle.liberer('equipe-2');

    expect(cycle.revendicationsActives().map((r) => r.idEquipe)).toEqual(['equipe-1']);
  });
});

describe('worktree persistant — teams (axe B)', () => {
  test('☠ mise en veille puis réveil : le worktree est CONSERVÉ et RÉUTILISÉ sans nouveau git worktree add', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire });

    const premiere = await cycle.allouer({ projet: projetGit(), idEquipe: 'team-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });
    expect(gestionnaire.appelsCreer).toHaveLength(1);

    // Fin d'activation, team vivante → veille (aucune suppression).
    const enVeille = cycle.mettreEnVeille('team-1');
    expect(enVeille.etat).toBe('en_veille');
    expect(gestionnaire.appelsSupprimer).toHaveLength(0);

    // Réveil : epoch strictement supérieur → réutilisation, PAS de nouveau worktree.
    const reveil = await cycle.allouer({ projet: projetGit(), idEquipe: 'team-1', epoch: 2, racineWorktrees: RACINE_WORKTREES });
    expect(reveil.etat).toBe('revendiquee');
    expect(reveil.worktreePath).toBe(premiere.worktreePath);
    expect(reveil.brancheDediee).toBe(premiere.brancheDediee);
    expect(reveil.epoch).toBe(2);
    expect(gestionnaire.appelsCreer).toHaveLength(1); // toujours 1 : aucun git worktree add au réveil
  });

  test('☠ le fencing tient au réveil : un epoch qui ne progresse pas est rejeté même en veille', async () => {
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    await cycle.allouer({ projet: projetGit(), idEquipe: 'team-1', epoch: 5, racineWorktrees: RACINE_WORKTREES });
    cycle.mettreEnVeille('team-1');
    await expect(
      cycle.allouer({ projet: projetGit(), idEquipe: 'team-1', epoch: 5, racineWorktrees: RACINE_WORKTREES }),
    ).rejects.toThrow(EpochNonCroissantError);
  });

  test('mettre en veille une clé sans revendication active lève', () => {
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire: new GestionnaireWorktreeGitFactice() });
    expect(() => cycle.mettreEnVeille('fantome')).toThrow(AucuneRevendicationActiveError);
  });

  test('☠ démantèlement : un worktree EN VEILLE et propre est bien supprimé', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice({ sale: false }), gestionnaire });
    const rev = await cycle.allouer({ projet: projetGit(), idEquipe: 'team-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });
    cycle.mettreEnVeille('team-1');

    const liberee = await cycle.liberer('team-1');
    expect(liberee.etat).toBe('liberee');
    expect(gestionnaire.appelsSupprimer).toEqual([{ cheminDepot: rev.cheminDepot, worktreePath: rev.worktreePath }]);
  });
});

/**
 * `☠` Restauration PC (axe B) : au démarrage du superviseur, la Map du
 * gestionnaire est vide alors que les worktrees des teams dormantes survivent sur
 * disque. Sans réamorçage, un réveil retenterait `git worktree add` sur un
 * répertoire existant. Preuve : après reconstruction `en_veille`, un réveil
 * RÉUTILISE le worktree, `git worktree add` n'est jamais rappelé.
 */
describe('restaurerRevendicationEnVeille — réamorçage au redémarrage du PC (axe B)', () => {
  test('☠ Map vide → revendication en veille reconstruite → un réveil NE refait PAS git worktree add', async () => {
    const interrogateur = new InterrogateurGitFactice();
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur, gestionnaire });

    // « Redémarrage » : rien en mémoire, le worktree survit pourtant sur disque.
    expect(cycle.revendicationDe('team-1')).toBeUndefined();

    cycle.restaurerRevendicationEnVeille({
      idEquipe: 'team-1',
      projetId: '/mnt/projects/vela',
      cheminDepot: '/mnt/projects/vela',
      worktreePath: '/mnt/projects/.worktrees/team-1',
      brancheDediee: 'equipe/team-1',
    });
    expect(cycle.revendicationDe('team-1')?.etat).toBe('en_veille');

    // Réveil : allouer avec un epoch strictement supérieur (dispatch réel).
    const reactivee = await cycle.allouer({
      projet: projetGit(),
      idEquipe: 'team-1',
      epoch: 5,
      racineWorktrees: RACINE_WORKTREES,
    });

    // Worktree persistant RÉUTILISÉ, aucun git worktree add.
    expect(reactivee.worktreePath).toBe('/mnt/projects/.worktrees/team-1');
    expect(reactivee.etat).toBe('revendiquee');
    expect(gestionnaire.appelsCreer).toHaveLength(0);
  });

  test('ne remplace JAMAIS une revendication déjà présente (état vivant préservé)', async () => {
    const gestionnaire = new GestionnaireWorktreeGitFactice();
    const cycle = new GestionnaireCycleVieWorktree({ interrogateur: new InterrogateurGitFactice(), gestionnaire });
    const vivante = await cycle.allouer({ projet: projetGit(), idEquipe: 'team-1', epoch: 1, racineWorktrees: RACINE_WORKTREES });

    cycle.restaurerRevendicationEnVeille({
      idEquipe: 'team-1',
      projetId: '/mnt/projects/vela',
      cheminDepot: '/mnt/projects/vela',
      worktreePath: '/autre/chemin',
      brancheDediee: 'equipe/team-1',
    });

    // La revendication vivante n'a pas été écrasée par la restauration.
    expect(cycle.revendicationDe('team-1')?.worktreePath).toBe(vivante.worktreePath);
    expect(cycle.revendicationDe('team-1')?.etat).toBe('revendiquee');
  });
});
