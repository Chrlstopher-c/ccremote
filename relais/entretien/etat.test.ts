// Responsabilité : tests de l'assemblage de l'état d'entretien — versions et empreintes, machine locale, ressources.
import { describe, expect, test } from 'bun:test';
import type { VueMachine } from '../../commun/api-clients.ts';
import type { EtatMachine } from '../../commun/protocole-poste.ts';
import { assemblerEtat, type EntreeEtat } from './etat.ts';

const ETAT: EtatMachine = {
  cpu: 12.5,
  memoire: { utilisee: 100, totale: 200 },
  disque: { utilise: 10, total: 20 },
  charge: 0.4,
  demarreeDepuis: 3600,
  echange: { utilise: 5, total: 10 },
};

function vue(id: string, surcharge: Partial<VueMachine> = {}): VueMachine {
  return {
    id,
    description: `Machine ${id}`,
    racines: [],
    projets: [],
    comptes: [],
    etatComptes: [],
    version: '2.0.0',
    etat: ETAT,
    derniereVue: '2026-11-20T10:00:00.000Z',
    enLigne: true,
    ...surcharge,
  };
}

function entree(surcharge: Partial<EntreeEtat> = {}): EntreeEtat {
  return {
    relais: { version: '2.0.0', commit: 'abc', demarreLe: 'T0' },
    vues: [vue('tour'), vue('portable')],
    locale: 'tour',
    infos: (id) =>
      id === 'portable'
        ? { commit: 'def', empreinte: 'EMP-OLD', claudeCode: { cli: '2.0.31', sdk: '0.3.325' } }
        : { commit: 'abc', empreinte: 'EMP-NEW', claudeCode: null },
    empreinteAttendue: 'EMP-NEW',
    reveil: () => ({ possible: false, relaisPar: null }),
    ...surcharge,
  };
}

describe('état d’entretien', () => {
  test('machine locale : pas de comparaison de version ; distante : empreinte différente → pas à jour', () => {
    const { machines } = assemblerEtat(entree());
    const locale = machines.find((m) => m.id === 'tour');
    const distante = machines.find((m) => m.id === 'portable');
    expect(locale?.locale).toBe(true);
    expect(locale?.poste?.aJour).toBeNull();
    expect(distante?.poste).toEqual({
      version: '2.0.0',
      commit: 'def',
      empreinte: 'EMP-OLD',
      empreinteAttendue: 'EMP-NEW',
      aJour: false,
    });
    expect(distante?.controles.find((c) => c.id === 'version')?.action).toBe('mettre_a_jour');
    expect(distante?.claudeCode).toEqual({ cli: '2.0.31', sdk: '0.3.325' });
  });

  test('empreinte attendue absente (hors relais intégré) : aJour null, pas d’action', () => {
    const { machines } = assemblerEtat(entree({ empreinteAttendue: null }));
    expect(machines.find((m) => m.id === 'portable')?.poste?.aJour).toBeNull();
  });

  test('ressources depuis l’état de la machine, échange inclus, relevé à la date de la vue', () => {
    const { machines } = assemblerEtat(entree());
    expect(machines.find((m) => m.id === 'portable')?.ressources).toEqual({
      cpu: 12.5,
      memoire: { utilise: 100, total: 200 },
      echange: { utilise: 5, total: 10 },
      disque: { utilise: 10, total: 20 },
      charge: 0.4,
      demarreeDepuis: 3600,
      releveLe: '2026-11-20T10:00:00.000Z',
    });
  });

  test('machine hors ligne avec réveil : contrôle « réveiller », nom de repli sur l’id', () => {
    const { machines } = assemblerEtat(
      entree({
        vues: [vue('tour', { enLigne: false, description: '', etat: null, etatComptes: [] })],
        locale: null,
        reveil: () => ({ possible: true, relaisPar: 'portable' }),
      }),
    );
    const t = machines[0];
    expect(t?.nom).toBe('tour');
    expect(t?.reveil).toEqual({ possible: true, relaisPar: 'portable' });
    expect(t?.controles.find((c) => c.id === 'poste')?.action).toBe('reveiller');
    expect(t?.ressources).toBeNull();
  });
});
