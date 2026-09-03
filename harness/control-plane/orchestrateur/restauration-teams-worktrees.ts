/**
 * Responsabilité : produire, depuis la table `team` du Pi, la liste des
 * revendications de worktree `en_veille` à RECONSTRUIRE côté PC au démarrage du
 * superviseur (axe B, restauration PC).
 *
 * `☠` Pourquoi ce module existe. La Map mémoire du gestionnaire de worktrees du PC
 * est vide à chaque redémarrage du superviseur. Une team persistante `dormante`
 * garde pourtant son `git worktree` sur disque. Sans réamorçage, le prochain
 * réveil de cette team appellerait `git worktree add` sur un répertoire qui existe
 * déjà — et échouerait. Ce module lit les teams `dormante` porteuses d'un worktree
 * et les projette en `RevendicationEnVeilleRestauree` ; la composition transmet
 * cette liste au PC (canal transportable, jamais un import direct A↔B), qui appelle
 * `GestionnaireCycleVieWorktree.restaurerRevendicationEnVeille` pour chacune.
 *
 * `☠` Ne fait AUCUNE I/O worktree lui-même : il ne connaît ni le PC ni le disque.
 * Il ne fait que LIRE le registre (Pi) et PROJETER — la frontière A↔B reste nette.
 */

import type { Registre } from '../registre/index.ts';
import type { RevendicationEnVeilleRestauree } from '../../projets/index.ts';

/**
 * Projette les teams `dormante` porteuses d'un worktree en revendications
 * `en_veille` restaurables. `☠` `team.projet` EST le chemin du dépôt (le `cwd` du
 * dispatch) : il sert à la fois d'`id` de projet et de `cheminDepot`. La clé de
 * revendication est le `teamId` — c'est par lui que le worktree d'une team est
 * revendiqué (voir `worktree-wiring-workers.ts#cleRevendication`), et par lui qu'un
 * réveil le retrouve.
 */
export function revendicationsEnVeilleDepuisTeams(registre: Registre): readonly RevendicationEnVeilleRestauree[] {
  return registre.teams.listerDormantesAvecWorktree().flatMap((team) => {
    // `☠` Garde défensive : la requête ne rend que des worktrees non nuls, mais le
    // type `Team.worktree` reste `string | null` — on ne CONSTRUIT jamais une
    // revendication sans worktree, plutôt que de forcer le type au point d'usage.
    if (team.worktree === null) return [];
    return [
      {
        idEquipe: team.id,
        projetId: team.projet,
        cheminDepot: team.projet,
        worktreePath: team.worktree,
        brancheDediee: team.branche,
      },
    ];
  });
}
