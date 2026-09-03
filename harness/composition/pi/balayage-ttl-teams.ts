/**
 * Responsabilité : démanteler périodiquement, depuis le Pi, les teams `dormante`
 * inactives depuis plus que le TTL (Rebut, décision Chris 2026-09-03 : 7 jours) —
 * leur worktree accumule du disque pour rien.
 *
 * `☠` Boucle SÉPARÉE, sur le même modèle que `balayage-cloture.ts` : le TTL vit
 * dans le registre du Pi (table `team`), pas dans la télémétrie du PC. L'adosser
 * à la télémétrie laisserait des teams jamais démantelées dès que le PC s'éteint,
 * exactement le cas où le disque n'est libéré par personne.
 *
 * `☠` Horloge RÉELLE en prod (`Date.now()` au tick), injectable en test
 * (`maintenant`) : c'est ce qui rend la règle « 7 j → démantèlement » vérifiable
 * sans attendre une semaine.
 */

import { demantelerTeamsExpirees, TTL_TEAM_MS } from '../../control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts';
import type { LiberateurWorktreeTeam } from '../../control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts';
import type { Registre } from '../../control-plane/registre/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'balayage-ttl-teams' });

/**
 * Période GROSSIÈRE devant le TTL (7 j) : rien ne presse à l'heure près, et la
 * requête balaie toutes les teams dormantes. Une heure borne le retard à 1 h sur
 * une inactivité de sept jours.
 */
export const PERIODE_BALAYAGE_TTL_TEAMS_MS = 60 * 60 * 1000;

export interface OptionsBalayageTtlTeams {
  readonly registre: Registre;
  /** Libère le worktree d'une team démantelée (ressource PC, routée par le canal). */
  readonly liberateur: LiberateurWorktreeTeam | undefined;
  readonly periodeMs?: number;
  readonly ttlMs?: number;
  /** Horloge injectable — défaut `Date.now`. `☠` Réévaluée À CHAQUE tick, jamais figée. */
  readonly maintenant?: () => number;
}

export interface BalayageTtlTeams {
  arreter(): void;
  /** Exposé pour être déclenché à la demande (tests, banc réel). */
  passer(): Promise<void>;
}

export function demarrerBalayageTtlTeams(options: OptionsBalayageTtlTeams): BalayageTtlTeams {
  const periode = options.periodeMs ?? PERIODE_BALAYAGE_TTL_TEAMS_MS;
  const ttlMs = options.ttlMs ?? TTL_TEAM_MS;
  const horloge = options.maintenant ?? Date.now;

  const passer = async (): Promise<void> => {
    try {
      const demantelees = await demantelerTeamsExpirees(options.registre, options.liberateur, horloge(), ttlMs);
      if (demantelees.length > 0) {
        log.info({ nombre: demantelees.length }, 'teams dormantes expirées démantelées (TTL, axe B)');
      }
    } catch (erreur) {
      // `demantelerTeamsExpirees` ne lève pas ; ce filet couvre une panne du registre lui-même.
      log.error({ err: erreur }, 'balayage TTL des teams en échec — la boucle continue');
    }
  };

  const minuterie = setInterval(() => void passer(), periode);
  // Ne retient pas le process en vie — même règle que les autres balayages.
  if (typeof minuterie.unref === 'function') minuterie.unref();

  return { arreter: (): void => clearInterval(minuterie), passer };
}
