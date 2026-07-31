// Tests du fil de mission tissé avec les permissions (C.4.2/H-64, mission M-50).
// ☠ Le bus d'escalade a été retiré le 2026-07-31 : plus aucune demande ne peut
// atteindre l'humain, donc `estRequiresAction` vaut désormais TOUJOURS `false`.
// Le cas « escaladée » a disparu avec sa source, il n'est pas commenté ailleurs.

import { describe, expect, test } from 'bun:test';
import type { EnregistrementAudit } from '../audit-permissions/index.ts';
import { evenementsPermissionsFil } from './permissions-fil.ts';

function audit(partial: Partial<EnregistrementAudit>): EnregistrementAudit {
  return {
    toolUseId: 'tu-1',
    outil: 'Bash',
    entreeTronquee: null,
    sessionId: 's1',
    cwd: null,
    agentId: null,
    permissionMode: 'auto',
    tentativeVueA: 10,
    verdict: 'autorise',
    auteur: 'classifieur_probable',
    motif: null,
    verdictA: 11,
    ...partial,
  };
}

describe('evenementsPermissionsFil — H-64 : tout dans le fil, requires_action distinct', () => {
  test('une autorisation auto-résolue par le lead apparaît, jamais marquée requires_action', () => {
    const evenements = evenementsPermissionsFil([audit({ verdict: 'autorise' })]);
    expect(evenements).toHaveLength(1);
    expect(evenements[0]?.estRequiresAction).toBe(false);
  });

  test('un refus du classifieur apparaît aussi, toujours silencieux (pas une escalade)', () => {
    const evenements = evenementsPermissionsFil([audit({ verdict: 'refuse', auteur: 'regle_scopee' })]);
    expect(evenements).toHaveLength(1);
    expect(evenements[0]?.estRequiresAction).toBe(false);
  });

  test('une tentative indéterminée n\'est jamais montrée — plus rien ne peut la trancher', () => {
    const evenements = evenementsPermissionsFil([audit({ verdict: 'indetermine' })]);
    expect(evenements).toHaveLength(0);
  });

  test('agentId connu route l\'événement sur la ligne du sous-agent, sinon la racine', () => {
    const [avecAgent] = evenementsPermissionsFil([audit({ agentId: 'agent-42' })]);
    expect(avecAgent?.nature === 'permission' ? avecAgent.ligneId : null).toBe('agent-42');
    const [sansAgent] = evenementsPermissionsFil([audit({ agentId: null })]);
    expect(sansAgent?.nature === 'permission' ? sansAgent.ligneId : null).toBe('principal');
  });
});
