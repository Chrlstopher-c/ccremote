/**
 * Responsabilité : côté Pi, transformer une liste de missions devenues
 * TERMINALES (mort réellement constatée, remontée par la réconciliation) en
 * fins d'activation de team — `traiterFinActivationTeam` pour chacune (axe B).
 *
 * `☠` LE PIÈGE CENTRAL de l'axe B, tenu ICI par construction. Une team ne doit
 * s'endormir qu'à la MORT CONSTATÉE d'une activation, JAMAIS à chaque `running →
 * idle` (fin de tour). Ces deux faits arrivent par deux canaux distincts et ne
 * se confondent pas :
 *  - `running → idle` → `detecterFinDeTour` → `signalerFinEquipe` (balayage de
 *    télémétrie). Une équipe respire à chaque tour : s'y accrocher endormirait la
 *    team à chaque souffle. CE MODULE N'Y TOUCHE JAMAIS.
 *  - mort constatée (fin réelle du flux, arrêt explicite, coupure du juge) → le
 *    worker devient `!vivant` → la réconciliation le voit fantôme et pose un état
 *    harness TERMINAL (`RapportReconciliation.fantomes`). C'est CETTE liste, et
 *    elle seule, qui alimente ce module.
 *
 * `☠` Une mission n'entre dans `fantomes` qu'UNE fois dans sa vie : une fois
 * l'état harness terminal posé, elle n'est plus `active`, donc plus jamais
 * relistée par une passe ultérieure. Traiter `fantomes` à chaque site d'appel de
 * `reconcilier` traite donc chaque mission exactement une fois, sans double
 * endormissement. `traiterFinActivationTeam` rend `hors_team` pour une mission
 * sans `teamId` : la liste peut contenir des missions hors team sans dommage.
 */

import { traiterFinActivationTeam, type DependancesFinActivation, type IssueFinActivation } from './fin-activation-team.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'finalisation-activations-teams' });

/**
 * Traite la fin d'activation de chaque mission devenue terminale. `☠` Best-effort
 * PAR MISSION : une exception sur l'une (worktree injoignable, machine hors ligne)
 * ne doit jamais empêcher les autres d'être finalisées. Rend les issues pour
 * journal/preuve. `maintenant` INJECTÉ pour rester testable (jamais `Date.now()`
 * au point d'usage).
 */
export async function finaliserActivationsTerminees(
  deps: DependancesFinActivation,
  missionsTerminees: readonly string[],
  maintenant: number = Date.now(),
): Promise<readonly IssueFinActivation[]> {
  const issues: IssueFinActivation[] = [];
  for (const missionId of missionsTerminees) {
    try {
      const issue = await traiterFinActivationTeam(deps, missionId, maintenant);
      issues.push(issue);
      if (issue.type !== 'hors_team') {
        log.info({ missionId, issue }, 'fin d’activation de team traitée (mort constatée, axe B)');
      }
    } catch (erreur) {
      log.error(
        { err: erreur, missionId },
        'finalisation d’activation de team en échec — les autres missions continuent',
      );
    }
  }
  return issues;
}
