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

describe('☠ l’epoch de fencing CROÎT réellement d’un dispatch à l’autre', () => {
  /** Termine la mission pour libérer le projet (H-56) sans effacer son epoch. */
  function terminer(missionId: string): void {
    registre.etats.appliquerEtatHarness(missionId, 'terminee');
  }

  test('deux dispatchs successifs sur le même projet ne portent pas le même epoch', async () => {
    const epochsEnvoyes: number[] = [];
    const depsTracantes = (): DependancesDispatch => ({
      ...deps(),
      demarreur: {
        demarrer: async (d: { epoch: number }) => {
          epochsEnvoyes.push(d.epoch);
          return { detail: 'ok' };
        },
      } as never,
    });

    const un = await dispatcherMandat(PROPOSITION, depsTracantes());
    terminer(un.missionId);
    const deux = await dispatcherMandat(PROPOSITION, depsTracantes());

    // Le défaut vécu : la colonne restait à 0, `prochainEpoch` rendait donc
    // toujours 1 et les deux workers portaient le MÊME epoch — précisément ce
    // que le fencing (M-11) doit rejeter.
    expect(epochsEnvoyes).toEqual([1, 2]);
    expect(registre.missions.lire(un.missionId)?.epoch).toBe(1);
    expect(registre.missions.lire(deux.missionId)?.epoch).toBe(2);
  });

  test('☠ l’epoch ENVOYÉ au PC est celui ÉCRIT au registre — deux calculs divergeraient', async () => {
    let envoye = -1;
    const d: DependancesDispatch = {
      ...deps(),
      demarreur: {
        demarrer: async (dem: { epoch: number }) => {
          envoye = dem.epoch;
          return { detail: 'ok' };
        },
      } as never,
    };
    const r = await dispatcherMandat(PROPOSITION, d);
    expect(registre.missions.lire(r.missionId)?.epoch).toBe(envoye);
  });

  test('un projet DIFFÉRENT repart à 1 — le fencing est par worktree, pas global', async () => {
    const premier = await dispatcherMandat(PROPOSITION, deps());
    terminer(premier.missionId);
    const autreProposition = { ...(PROPOSITION as object), projet: '/mnt/projects/agora' } as never;
    const autre = await dispatcherMandat(autreProposition, deps());
    expect(registre.missions.lire(autre.missionId)?.epoch).toBe(1);
  });

  test('☠ l’epoch ne REDESCEND pas quand d’autres projets saturent la fenêtre de récence', async () => {
    const premier = await dispatcherMandat(PROPOSITION, deps());
    terminer(premier.missionId);
    expect(registre.missions.lire(premier.missionId)?.epoch).toBe(1);

    // `listerRecentes()` ne rend que les 200 dernières missions, TOUS projets
    // confondus, triées par activité. Passé ce seuil la mission ci-dessus en
    // sort, et un maximum calculé sur cette fenêtre retombe à 0 : le dispatch
    // suivant réémettrait l'epoch 1 et le fencing (M-11) tuerait le worker.
    registre.lots.creer({ id: 'lot-bruit', intention: 'bruit' });
    for (let i = 0; i < 250; i += 1) {
      const m = registre.missions.creer({
        id: `bruit-${i}`,
        lotId: 'lot-bruit',
        nom: 'bruit',
        projet: '/mnt/projects/autre',
        compteId: 'compte-a',
      });
      registre.etats.appliquerEtatHarness(m.id, 'terminee');
    }

    const second = await dispatcherMandat(PROPOSITION, deps());
    expect(registre.missions.lire(second.missionId)?.epoch).toBe(2);
  });
});
