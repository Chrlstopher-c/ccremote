import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { dispatcherMandat, ErreurProjetOccupe, type DependancesDispatch } from './dispatch-mandat.ts';

let registre: Registre;

const PROPOSITION = {
  id: 'prop-1',
  projet: '/mnt/projects/vela',
  objectif: 'Auditer Vela',
  critereArret: 'rapport rendu',
  perimetre: 'lecture seule',
  budgetMaxUsd: 12,
  modele: null,
  effort: null,
} as never;

function deps(): DependancesDispatch {
  return {
    registre,
    demarreur: { demarrer: async () => ({ detail: 'équipe démarrée' }) } as never,
    repertoireProjets: '/mnt/projects',
  };
}

/** Sème une mission ACTIVE sur le projet — exactement ce que H-56 doit bloquer. */
function semerMissionActive(projet: string): string {
  registre.lots.creer({ id: 'lot-1', intention: 'précédente' });
  const m = registre.missions.creer({
    id: 'm-bloquante',
    lotId: 'lot-1',
    nom: 'précédente',
    projet,
    compteId: 'compte-a',
  });
  registre.etats.appliquerEtatHarness(m.id, 'en_cours');
  return m.id;
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
});

afterEach(() => registre.fermer());

describe('dispatch — une seule équipe active par projet (H-56)', () => {
  test('☠ refus NOMMÉ, jamais une contrainte SQLite en 500 « erreur interne »', async () => {
    const bloquante = semerMissionActive('/mnt/projects/vela');
    const erreur = await dispatcherMandat(PROPOSITION, deps()).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurProjetOccupe);
    // Le message doit dire QUOI bloque et QUOI faire — sinon on clique trois
    // fois sans comprendre, ce qui est arrivé en prod le 23/07.
    expect((erreur as Error).message).toContain(bloquante.slice(0, 8));
    expect((erreur as Error).message).toContain('arreter_equipe');
  });

  test('☠ le contrôle a lieu AVANT toute écriture — aucun lot orphelin laissé derrière', async () => {
    semerMissionActive('/mnt/projects/vela');
    await dispatcherMandat(PROPOSITION, deps()).catch(() => undefined);
    expect(registre.lots.listerRecents().length).toBe(1); // le lot semé, et lui seul
  });

  test('une mission TERMINÉE ne bloque pas — le projet est libre', async () => {
    const bloquante = semerMissionActive('/mnt/projects/vela');
    registre.etats.appliquerEtatHarness(bloquante, 'terminee');
    const r = await dispatcherMandat(PROPOSITION, deps());
    expect(r.missionId).toBeDefined();
  });

  test('un AUTRE projet n’est jamais bloqué par celui-ci', async () => {
    semerMissionActive('/mnt/projects/nullnode');
    const r = await dispatcherMandat(PROPOSITION, deps());
    expect(r.missionId).toBeDefined();
  });
});
