import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import { demarrerBalayageTtlTeams } from './balayage-ttl-teams.ts';
import {
  TTL_TEAM_MS,
  type LiberateurWorktreeTeam,
} from '../../control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts';

let registre: Registre;
beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
});
afterEach(() => registre.fermer());

const T0 = 1_000_000;

test('☠ team dormante inactive au-delà du TTL → démantelée, worktree libéré (horloge injectée)', async () => {
  registre.teams.creer({ id: 'team-1', projet: 'vela', domaine: 'frontend', worktree: '/wt/team-1' }, T0);
  const liberes: string[] = [];
  const liberateur: LiberateurWorktreeTeam = {
    libererWorktree: async (teamId: string): Promise<void> => {
      liberes.push(teamId);
    },
  };
  const balayage = demarrerBalayageTtlTeams({
    registre,
    liberateur,
    maintenant: () => T0 + TTL_TEAM_MS + 1,
  });
  await balayage.passer();
  balayage.arreter();

  expect(registre.teams.lire('team-1')?.etat).toBe('demantelee');
  expect(liberes).toEqual(['team-1']);
});

test('team dormante récente (sous le TTL) → intacte', async () => {
  registre.teams.creer({ id: 'team-2', projet: 'vela', domaine: 'backend', worktree: '/wt/team-2' }, T0);
  const balayage = demarrerBalayageTtlTeams({
    registre,
    liberateur: undefined,
    maintenant: () => T0 + TTL_TEAM_MS - 1,
  });
  await balayage.passer();
  balayage.arreter();

  expect(registre.teams.lire('team-2')?.etat).toBe('dormante');
});
