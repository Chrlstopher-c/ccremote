import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import type { JetonCompte, QuotaCompteMesure } from '../../superviseur/index.ts';
import { demarrerBalayageQuotas } from './balayage-quotas.ts';

let registre: Registre;

const JETON: JetonCompte = { compteId: 'compte-a', jetonAcces: 'sk-ant-oat01-x', expireA: 9_999_999_999_999 };

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
});

afterEach(() => registre.fermer());

async function balayer(
  mesures: readonly QuotaCompteMesure[],
  jetons: readonly JetonCompte[] = [JETON],
): Promise<readonly JetonCompte[]> {
  const sondes: JetonCompte[] = [];
  const b = demarrerBalayageQuotas({
    registre,
    source: { jetons: async () => jetons },
    sonder: async (j) => {
      sondes.push(...j);
      return mesures;
    },
  });
  await b.passer();
  b.arreter();
  return sondes;
}

const MESURE: QuotaCompteMesure = {
  compteId: 'compte-a',
  fenetres: [
    { typeFenetre: 'five_hour', utilisation: 84, resetA: 1_784_786_399_366 },
    { typeFenetre: 'seven_day', utilisation: 91, resetA: 1_784_792_399_366 },
  ],
  email: 'x@y.z',
  typeAbonnement: 'Claude Pro',
  creditsPayantsActifs: false,
  observeA: 1_000,
};

describe('balayage — jauges de rate limit', () => {
  test('☠ l’usage mesuré est écrit au registre (avant : 0 % en permanence, 23/07)', async () => {
    await balayer([MESURE]);
    const quotas = registre.comptes.listerQuotas('compte-a');
    const cinqH = quotas.find((q) => q.typeFenetre === 'five_hour');
    expect(cinqH?.utilisation).toBe(84);
    expect(cinqH?.resetA).toBe(1_784_786_399_366);
    expect(cinqH?.statut).toBe('allowed_warning');
  });

  test('☠ une fenêtre à 100 % marque le compte rejected — sinon le dispatch fonce dedans (H-53)', async () => {
    await balayer([{ ...MESURE, fenetres: [{ typeFenetre: 'five_hour', utilisation: 100, resetA: null }] }]);
    expect(registre.comptes.listerQuotas('compte-a')[0]?.statut).toBe('rejected');
  });

  test('☠ une sonde EN ÉCHEC n’écrase pas une jauge connue par un zéro', async () => {
    await balayer([MESURE]);
    await balayer([{ ...MESURE, fenetres: [], echec: 'sonde expirée' }]);
    const cinqH = registre.comptes.listerQuotas('compte-a').find((q) => q.typeFenetre === 'five_hour');
    // Un zéro écrit ici ferait croire à un compte libre alors qu'il est à 84 %.
    expect(cinqH?.utilisation).toBe(84);
  });
});

describe('balayage — identité mesurée du compte', () => {
  test('☠ email et abonnement viennent de la SONDE, jamais d’un libellé écrit en dur', async () => {
    await balayer([MESURE]);
    const compte = registre.comptes.lire('compte-a');
    expect(compte?.email).toBe('x@y.z');
    expect(compte?.typeAbonnement).toBe('Claude Pro');
  });

  test('une sonde sans identité n’efface pas ce qu’on savait déjà', async () => {
    await balayer([MESURE]);
    await balayer([{ ...MESURE, email: null, typeAbonnement: null }]);
    expect(registre.comptes.lire('compte-a')?.email).toBe('x@y.z');
  });
});

describe('balayage — jetons, et survie au PC éteint', () => {
  test('☠ le jeton relevé sur le PC est PERSISTÉ — sans ça, tout se fige à son extinction', async () => {
    await balayer([MESURE]);
    expect(registre.comptes.listerJetons()).toEqual([
      { compteId: 'compte-a', jetonAcces: 'sk-ant-oat01-x', expireA: 9_999_999_999_999 },
    ]);
  });

  test('☠ PC éteint (aucun jeton relevé), la sonde tourne quand même sur le jeton persisté', async () => {
    await balayer([MESURE]);
    // Deuxième passe SANS le PC : c'est le cas que toute la refonte vise.
    const sondes = await balayer([{ ...MESURE, fenetres: [{ typeFenetre: 'five_hour', utilisation: 90, resetA: null }] }], []);
    expect(sondes).toHaveLength(1);
    expect(registre.comptes.listerQuotas('compte-a').find((q) => q.typeFenetre === 'five_hour')?.utilisation).toBe(90);
  });

  test('aucun jeton connu ⇒ aucune sonde, plutôt qu’un appel voué au 401', async () => {
    const sondes = await balayer([MESURE], []);
    expect(sondes).toHaveLength(0);
  });
});

describe('☠ un compte ne peut plus être affamé par un autre (vécu 25→31/07)', () => {
  const JETON_B: JetonCompte = { compteId: 'compte-b', jetonAcces: 'sk-ant-oat01-y', expireA: 9_999_999_999_999 };

  /** Sonde à mémoire : garde la trace de chaque passe, comme le ferait le réseau. */
  function balayageDeuxComptes(): {
    passes: JetonCompte[][];
    profils: boolean[];
    passer: () => Promise<void>;
    arreter: () => void;
  } {
    const passes: JetonCompte[][] = [];
    const profils: boolean[] = [];
    const b = demarrerBalayageQuotas({
      registre,
      source: { jetons: async () => [JETON, JETON_B] },
      sonder: async (j, _maintenant, avecProfil) => {
        passes.push([...j]);
        profils.push(avecProfil ?? true);
        return j.map((x) => ({ ...MESURE, compteId: x.compteId }));
      },
    });
    return { passes, profils, passer: b.passer, arreter: b.arreter };
  }

  test('une passe ne sonde QU’UN compte — deux requêtes simultanées, et l’endpoint en rejette une', async () => {
    registre.comptes.enregistrer({ id: 'compte-b', configDir: '/tmp/b' });
    const { passes, passer, arreter } = balayageDeuxComptes();
    await passer();
    arreter();
    expect(passes).toHaveLength(1);
    expect(passes[0]).toHaveLength(1);
  });

  test('☠ deux passes couvrent les DEUX comptes — avant, le perdant l’était à chaque fois', async () => {
    registre.comptes.enregistrer({ id: 'compte-b', configDir: '/tmp/b' });
    const { passes, passer, arreter } = balayageDeuxComptes();
    await passer();
    await passer();
    arreter();
    const sondes = passes.flat().map((j) => j.compteId).sort();
    expect(sondes).toEqual(['compte-a', 'compte-b']);
  });

  test('le profil n’est redemandé que tant que l’identité manque — il doublait le trafic pour rien', async () => {
    registre.comptes.enregistrer({ id: 'compte-b', configDir: '/tmp/b' });
    const { profils, passer, arreter } = balayageDeuxComptes();
    await passer();
    // La première passe a écrit email + abonnement de compte-a : le tour suivant
    // de ce compte n'a plus rien à apprendre de `/profile`.
    await passer();
    await passer();
    arreter();
    expect(profils[0]).toBe(true);
    expect(profils[2]).toBe(false);
  });
});
