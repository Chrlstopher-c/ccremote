// Demandes d'appairage : une décision par demande (accord, refus, expiration), jamais deux fois ; retrait par membre.
import { describe, expect, test } from 'bun:test';
import { DemandesAppairage } from './demandes.ts';

const DONNEES = { membre: 'a1b2c3d4e5f6', nom: 'portable', empreinte: 'E1', empreinteLocale: 'L1' };
const attendre = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('demandes d’appairage', () => {
  test('l’accord tranche une fois, la demande disparaît', () => {
    const d = new DemandesAppairage(10_000, () => 0);
    const decisions: boolean[] = [];
    const demande = d.ajouter(DONNEES, (accord) => decisions.push(accord));
    expect(d.lister()).toEqual([demande]);
    expect(d.decider(demande.id, true)).toBe(true);
    expect(d.decider(demande.id, false)).toBe(false);
    expect(decisions).toEqual([true]);
    expect(d.lister()).toEqual([]);
    d.arreter();
  });

  test('sans réponse dans le délai, la demande est refusée', async () => {
    const d = new DemandesAppairage(20, () => 0);
    const decisions: boolean[] = [];
    d.ajouter(DONNEES, (accord) => decisions.push(accord));
    await attendre(60);
    expect(decisions).toEqual([false]);
    expect(d.lister()).toEqual([]);
  });

  test('retirer les demandes d’un membre ne décide rien à sa place', () => {
    const d = new DemandesAppairage(10_000, () => 0);
    const decisions: boolean[] = [];
    d.ajouter(DONNEES, (accord) => decisions.push(accord));
    d.retirerPour(DONNEES.membre);
    expect(d.lister()).toEqual([]);
    expect(decisions).toEqual([]);
    d.arreter();
  });
});
