import { describe, expect, test } from 'bun:test';
import { attendre, nouvelleSession } from './faux-sdk.ts';
import { RAISON_REDEMARRAGE, TEXTE_REDEMARRAGE } from './reprise.ts';

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('SessionSdk — reprise au démarrage du poste', () => {
  test('une session qui attendait Chris n’a aucun processus au démarrage ; elle garde sa conversation', async () => {
    const textes: string[] = [];
    const { session, requetes, evenements } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        return [{ type: 'result' }];
      },
      { reprise: { statut: 'attente', aReprendre: true } },
    );
    expect(session.resume.statut).toBe('attente');
    expect(session.vivante).toBe(false);
    await pause(20);
    expect(requetes).toHaveLength(0);
    expect(textes).toHaveLength(0);
    expect(evenements).toHaveLength(0);
    expect(session.persistee.aReprendre).toBe(true);
  });

  test('un tour interrompu par le redémarrage reprend avec le message du poste, relance dans le fil', async () => {
    const textes: string[] = [];
    const { session, requetes, evenements } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        return [{ type: 'result' }];
      },
      { reprise: { statut: 'travail', aReprendre: true } },
    );
    expect(session.reprendreApresRedemarrage(TEXTE_REDEMARRAGE)).toBeNull();
    await attendre(() => textes.length === 1);
    expect(textes[0]).toBe(TEXTE_REDEMARRAGE);
    expect(evenements).toContainEqual({ type: 'relance', raison: RAISON_REDEMARRAGE });
    expect(evenements.some((e) => e.type === 'message')).toBe(false);
    expect(requetes[0]?.options.resume).toBe('claude-abc');
    await attendre(() => session.resume.statut === 'attente');
  });

  test('une conversation introuvable laisse la session fermée, avec un événement d’erreur lisible', () => {
    const { session, requetes, evenements } = nouvelleSession(async () => [], {
      reprise: { statut: 'attente', aReprendre: true, claudeSessionId: null },
    });
    expect(session.reprendreApresRedemarrage(TEXTE_REDEMARRAGE)).toMatch(/conversation inconnue/);
    expect(session.resume.statut).toBe('fermee');
    expect(evenements.some((e) => e.type === 'erreur')).toBe(true);
    expect(requetes).toHaveLength(0);
    expect(session.persistee.aReprendre).toBe(false);
  });

  test('avant la reprise la session garde son statut d’avant l’arrêt ; sans reprise elle est fermée', () => {
    const attendue = nouvelleSession(async () => [], { reprise: { statut: 'compaction', aReprendre: true } });
    expect(attendue.session.resume.statut).toBe('compaction');
    expect(attendue.session.persistee.resume.statut).toBe('compaction');
    const ancienne = nouvelleSession(async () => [], { reprise: { statut: 'travail', aReprendre: false } });
    expect(ancienne.session.resume.statut).toBe('fermee');
  });

  test('fermer une session la retire de la reprise au démarrage ; lancer l’y remet', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('un');
    expect(session.persistee.aReprendre).toBe(true);
    await attendre(() => session.resume.statut === 'attente');
    await session.fermer();
    expect(session.persistee.aReprendre).toBe(false);
    await session.reprendre('deux');
    expect(session.persistee.aReprendre).toBe(true);
  });
});
