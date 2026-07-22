// Tests du fil de mission tissé avec les permissions (C.4.2/H-64, mission M-50).
// ☠ CASSE couvert : `requires_action` doit être visuellement distinct (acceptation b),
// et SEULEMENT pour une escalade humaine réelle (H-40 : le reste est silencieux).

import { describe, expect, test } from 'bun:test';
import type { EnregistrementAudit } from '../audit-permissions/index.ts';
import type { DemandePermission } from '../bus-permissions/index.ts';
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

function demandeEnAttente(requestId: string): DemandePermission {
  return {
    requestId,
    idWorker: 'w1',
    outil: 'Bash',
    etat: 'en_attente',
    verdict: null,
    recueA: 5,
    enAttenteDepuisA: 6,
    repondueA: null,
    confirmeeA: null,
  };
}

describe('evenementsPermissionsFil — H-64 : tout dans le fil, requires_action distinct', () => {
  test('une autorisation auto-résolue par le lead apparaît, jamais marquée requires_action', () => {
    const evenements = evenementsPermissionsFil([audit({ verdict: 'autorise' })], []);
    expect(evenements).toHaveLength(1);
    expect(evenements[0]?.estRequiresAction).toBe(false);
  });

  test('un refus du classifieur apparaît aussi, toujours silencieux (pas une escalade)', () => {
    const evenements = evenementsPermissionsFil([audit({ verdict: 'refuse', auteur: 'regle_scopee' })], []);
    expect(evenements).toHaveLength(1);
    expect(evenements[0]?.estRequiresAction).toBe(false);
  });

  test('une demande réellement escaladée à l\'humain est marquée requires_action (b)', () => {
    const evenements = evenementsPermissionsFil(
      [audit({ toolUseId: 'tu-2', verdict: 'indetermine', auteur: 'inconnu' })],
      [demandeEnAttente('tu-2')],
    );
    expect(evenements).toHaveLength(1);
    expect(evenements[0]?.estRequiresAction).toBe(true);
  });

  test('une tentative indéterminée non escaladée n\'est pas encore montrée (rien à afficher)', () => {
    const evenements = evenementsPermissionsFil([audit({ verdict: 'indetermine' })], []);
    expect(evenements).toHaveLength(0);
  });

  test('agentId connu route l\'événement sur la ligne du sous-agent, sinon la racine', () => {
    const [avecAgent] = evenementsPermissionsFil([audit({ agentId: 'agent-42' })], []);
    expect(avecAgent?.nature === 'permission' ? avecAgent.ligneId : null).toBe('agent-42');
    const [sansAgent] = evenementsPermissionsFil([audit({ agentId: null })], []);
    expect(sansAgent?.nature === 'permission' ? sansAgent.ligneId : null).toBe('principal');
  });
});
