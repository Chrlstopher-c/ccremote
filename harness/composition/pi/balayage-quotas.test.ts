import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import type { QuotaCompteMesure, TelemetrieWorker } from '../../superviseur/index.ts';
import { demarrerBalayageTelemetrie } from './balayage-telemetrie.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
});

afterEach(() => registre.fermer());

async function balayer(quotas: readonly QuotaCompteMesure[]) {
  const b = demarrerBalayageTelemetrie({
    registre,
    source: {
      telemetrie: async (): Promise<readonly TelemetrieWorker[]> => [],
      quotas: async () => quotas,
    },
  });
  await b.passer();
  b.arreter();
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
