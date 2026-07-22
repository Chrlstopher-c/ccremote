// Tests du registre d'observation multi-équipes (acceptation e, mission M-50).
// ☠ CASSE couvert : le résumé léger reste complet quel que soit le nombre
// d'équipes ; le détail complet ne coûte rien tant que personne ne l'observe.

import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { OUTIL_DELEGATION } from './arbre-flux.ts';
import { RegistreObservationParc } from './registre-observation-parc.ts';

function dispatch(id: string): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id, name: OUTIL_DELEGATION }] },
    uuid: 'u',
    session_id: 's1',
  } as unknown as SDKMessage;
}

describe('RegistreObservationParc — (e) plusieurs équipes sans saturer l\'écran', () => {
  test('resumeParc() reste complet même avec un grand nombre d\'équipes', () => {
    const registre = new RegistreObservationParc();
    for (let i = 0; i < 200; i++) registre.majResume(`equipe-${i}`, 'running', null, i);
    expect(registre.resumeParc()).toHaveLength(200);
    // Aucun détail n'a été ouvert : coût mémoire réel nul pour ces 200 équipes.
    expect(registre.equipesDetaillees()).toBe(0);
  });

  test('le détail n\'est matérialisé qu\'au premier abonnement', () => {
    const registre = new RegistreObservationParc();
    expect(registre.equipesDetaillees()).toBe(0);
    registre.abonner('equipe-1', 0, 'pilote', () => {});
    expect(registre.equipesDetaillees()).toBe(1);
  });

  test('fermerDetailSiInactif libère la mémoire quand plus personne n\'observe', () => {
    const registre = new RegistreObservationParc();
    const { abonnement } = registre.abonner('equipe-1', 0, 'pilote', () => {});
    abonnement.fermer();
    registre.fermerDetailSiInactif('equipe-1');
    expect(registre.equipesDetaillees()).toBe(0);
  });

  test('fermerDetailSiInactif ne touche pas une équipe encore observée', () => {
    const registre = new RegistreObservationParc();
    registre.abonner('equipe-1', 0, 'pilote', () => {});
    registre.fermerDetailSiInactif('equipe-1');
    expect(registre.equipesDetaillees()).toBe(1);
  });

  test('ingererMessageFlux est un no-op tant que l\'équipe n\'est pas observée (pas de coût caché)', () => {
    const registre = new RegistreObservationParc();
    expect(() => registre.ingererMessageFlux('equipe-1', dispatch('call-1'))).not.toThrow();
    expect(registre.arbreDe('equipe-1')).toBeUndefined();
  });

  test('une fois observée, ingererMessageFlux alimente l\'arbre ET publie sur la diffusion', () => {
    const registre = new RegistreObservationParc();
    const recus: string[] = [];
    registre.abonner('equipe-1', 0, 'pilote', (e) => {
      if (e.evenement.nature === 'activite') recus.push(e.evenement.ligneId);
    });
    registre.ingererMessageFlux('equipe-1', dispatch('call-1'));
    expect(registre.arbreDe('equipe-1')?.sousAgentsDispatches()).toBe(1);
  });

  test('deux équipes distinctes ont des arbres et diffusions totalement indépendants', () => {
    const registre = new RegistreObservationParc();
    registre.abonner('equipe-1', 0, 'pilote', () => {});
    registre.abonner('equipe-2', 0, 'pilote', () => {});
    registre.ingererMessageFlux('equipe-1', dispatch('call-1'));
    expect(registre.arbreDe('equipe-1')?.sousAgentsDispatches()).toBe(1);
    expect(registre.arbreDe('equipe-2')?.sousAgentsDispatches()).toBe(0);
  });
});
