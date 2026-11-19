import { describe, expect, test } from 'bun:test';
import { calculerAcces, avancerAcces, type FaitsAcces } from './etat-acces.ts';
import { AccesMachines } from './acces-machines.ts';
import { RegistreMachines } from './registre-machines.ts';
import { ouvrirBase } from '../registre/base.ts';

const BASE: FaitsAcces = {
  configuree: true,
  installee: true,
  posteEnLigne: false,
  tunnelOuvert: false,
  detailTunnel: null,
};

describe('état d’accès d’une machine', () => {
  test('la table : local, non installé, connecté, connexion, injoignable', () => {
    expect(calculerAcces({ ...BASE, configuree: false, posteEnLigne: true })).toEqual({ etat: 'local', detail: null });
    expect(calculerAcces({ ...BASE, configuree: false }).etat).toBe('injoignable');
    expect(calculerAcces({ ...BASE, installee: false }).etat).toBe('non_installe');
    expect(calculerAcces({ ...BASE, posteEnLigne: true, tunnelOuvert: true }).etat).toBe('connecte');
    expect(calculerAcces({ ...BASE, tunnelOuvert: true }).etat).toBe('connexion');
    expect(calculerAcces({ ...BASE, detailTunnel: 'Connection refused — relance dans 4 s' })).toEqual({
      etat: 'injoignable',
      detail: 'Connection refused — relance dans 4 s',
    });
  });

  test('le depuis ne bouge que sur un changement d’état ou de détail', () => {
    const premier = avancerAcces(undefined, { etat: 'connecte', detail: null }, 't1');
    expect(premier.depuis).toBe('t1');
    expect(avancerAcces(premier, { etat: 'connecte', detail: null }, 't2')).toBe(premier);
    expect(avancerAcces(premier, { etat: 'injoignable', detail: 'x' }, 't3')).toEqual({
      etat: 'injoignable',
      detail: 'x',
      depuis: 't3',
    });
  });
});

describe('accès des machines vues par le relais', () => {
  function montage(installees: string[], enLigne: string[]) {
    const registre = new RegistreMachines(ouvrirBase(':memory:'));
    for (const id of ['pi', 'tour']) {
      registre.inserer(
        {
          id,
          description: `Machine ${id}`,
          hote: 'h.exemple.test',
          port: 22,
          utilisateur: 'u',
          cle: '/k',
          dossier: '~',
        },
        47321,
        't0',
      );
    }
    return new AccesMachines({
      configurations: () => registre.lister(),
      installee: (id) => installees.includes(id),
      tunnel: (id) => ({ ouvert: enLigne.includes(id), detail: enLigne.includes(id) ? null : 'refusé' }),
      enLigne: (id) => enLigne.includes(id),
      connue: (id) => id === 'pi',
      installation: () => null,
      maintenant: () => 'maintenant',
    });
  }

  test('de() : connecté pour le poste en ligne, non installé sinon', () => {
    const acces = montage(['pi', 'tour'], ['pi']);
    expect(acces.de('pi').etat).toBe('connecte');
    expect(acces.de('tour').etat).toBe('injoignable');
  });

  test('sansPoste() : la machine configurée sans fiche de poste part avec son état, hors ligne', () => {
    const acces = montage([], []);
    const fiches = acces.sansPoste();
    expect(fiches.map((f) => f.id)).toEqual(['tour']);
    expect(fiches[0]).toMatchObject({ enLigne: false, acces: { etat: 'non_installe' } });
  });
});
