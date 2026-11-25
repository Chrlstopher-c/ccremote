import { describe, expect, test } from 'bun:test';
import { notificationPour } from './regles.ts';

describe('alerte envoyée par un agent', () => {
  test('notification « important » (relayée à l’iPhone), titre de l’agent après celui de la session', () => {
    const evt = { type: 'notification_agent', message: 'Prêt à tester', titre: 'Build' } as const;
    expect(notificationPour('Pi Services', evt)).toEqual({
      niveau: 'important',
      titre: 'Pi Services — Build',
      texte: 'Prêt à tester',
    });
    const sansTitre = { type: 'notification_agent', message: 'x', titre: null } as const;
    expect(notificationPour('Pi Services', sansTitre)?.titre).toBe('Pi Services');
  });
});
