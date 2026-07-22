/**
 * Tests de l'identité de session fixe (A.1.2, acceptation (b)).
 */
import { describe, expect, test } from 'bun:test';
import { resoudreIdentite, type StockageIdentite, type VerificateurSessionExistante } from './identite.ts';

function stockageMemoire(initial: string | null = null): StockageIdentite & { valeur: string | null } {
  return {
    valeur: initial,
    lire() {
      return this.valeur;
    },
    ecrire(sessionId: string) {
      this.valeur = sessionId;
    },
  };
}

function verificateur(sessionsConnues: readonly string[]): VerificateurSessionExistante {
  return { existe: async (sessionId) => sessionsConnues.includes(sessionId) };
}

describe('résolution d’identité (A.1.2)', () => {
  test('premier démarrage : crée un UUID et le persiste, mode demarrage_froid', async () => {
    const stockage = stockageMemoire(null);
    const decision = await resoudreIdentite(stockage, verificateur([]));
    expect(decision.mode).toBe('demarrage_froid');
    expect(decision.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stockage.valeur).toBe(decision.sessionId);
  });

  test('deux résolutions successives sur le même stockage rendent le MÊME sessionId (b)', async () => {
    const stockage = stockageMemoire(null);
    const d1 = await resoudreIdentite(stockage, verificateur([]));
    const d2 = await resoudreIdentite(stockage, verificateur([d1.sessionId]));
    expect(d2.sessionId).toBe(d1.sessionId);
  });

  test('redémarrage avec une session connue du SDK ⇒ reprise', async () => {
    const stockage = stockageMemoire('id-existant');
    const decision = await resoudreIdentite(stockage, verificateur(['id-existant']));
    expect(decision).toEqual({ sessionId: 'id-existant', mode: 'reprise' });
  });

  test('☠ identité persistée mais SDK ne la connaît pas ⇒ demarrage_froid sur le MÊME id, jamais un nouveau', async () => {
    const stockage = stockageMemoire('id-fantome');
    const decision = await resoudreIdentite(stockage, verificateur([]));
    expect(decision).toEqual({ sessionId: 'id-fantome', mode: 'demarrage_froid' });
  });
});
