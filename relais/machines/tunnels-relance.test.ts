// Responsabilité : tests de la relance immédiate d'un tunnel et de la liste des processus ssh ouverts.
import { describe, expect, test } from 'bun:test';
import { type CibleTunnel, type LanceurTunnel, type ProcessusTunnel, Tunnels } from './tunnels.ts';

const CIBLE: CibleTunnel = {
  id: 'machine-a',
  connexion: { hote: 'h.exemple.test', port: 22, utilisateur: 'u', cle: '/k' },
  portDistant: 47321,
};

function banc() {
  const lances: { pid: number; arrete: boolean }[] = [];
  const lanceur: LanceurTunnel = (): ProcessusTunnel => {
    const f = { pid: 500 + lances.length, arrete: false };
    lances.push(f);
    return {
      pid: f.pid,
      sortie: new Promise<number>(() => undefined),
      erreurs: Promise.resolve(''),
      arreter: () => {
        f.arrete = true;
      },
    };
  };
  const planificateur = { planifier: () => 'minuterie', annuler: () => undefined };
  const t = new Tunnels({
    cibles: () => [CIBLE],
    portPostes: 8721,
    surChangement: () => undefined,
    lanceur,
    planificateur,
  });
  return { t, lances };
}

describe('relance immédiate d’un tunnel', () => {
  test('le ssh en cours part, un nouveau repart aussitôt, et l’état pointe sur le nouveau processus', () => {
    const { t, lances } = banc();
    t.synchroniser();
    expect(t.pids()).toEqual([{ id: 'machine-a', pid: 500 }]);
    t.relancer('machine-a');
    expect(lances.map((l) => l.arrete)).toEqual([true, false]);
    expect(t.pids()).toEqual([{ id: 'machine-a', pid: 501 }]);
    expect(t.etat('machine-a').ouvert).toBe(true);
  });

  test('une machine sans tunnel : rien ne se passe', () => {
    const { t, lances } = banc();
    t.relancer('inconnue');
    expect(lances).toEqual([]);
    expect(t.pids()).toEqual([]);
  });
});
