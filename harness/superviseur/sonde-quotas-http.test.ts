import { describe, expect, test } from 'bun:test';
import { enveloppeUsage, sonderQuotasHttp } from './sonde-quotas-http.ts';
import { extraireFenetres } from './sonde-quotas.ts';

/** Réponse RÉELLE de `GET /api/oauth/usage`, relevée en prod le 23/07 (jeton retiré). */
const REPONSE_REELLE = {
  five_hour: { utilization: 4.0, resets_at: '2026-07-23T20:00:00.042814+00:00', limit_dollars: null },
  seven_day: { utilization: 95.0, resets_at: '2026-07-26T19:00:00.042831+00:00', limit_dollars: null },
  seven_day_opus: null,
  extra_usage: { is_enabled: true, monthly_limit: 9800 },
};

describe('sonde HTTP — forme de la réponse OAuth', () => {
  test('☠ la réponse est PLATE, pas enveloppée dans `rate_limits` — sinon zéro jauge sur un HTTP 200', () => {
    const fenetres = extraireFenetres(enveloppeUsage(REPONSE_REELLE));
    const cinqH = fenetres.find((f) => f.typeFenetre === 'five_hour');
    expect(cinqH?.utilisation).toBe(4);
    expect(cinqH?.resetA).toBe(Date.parse('2026-07-23T20:00:00.042814+00:00'));
    // Le défaut vécu : liste vide, aucune erreur, jauges figées en silence.
    expect(fenetres).toHaveLength(2);
  });

  test('`extra_usage` n’est pas une fenêtre — le compter en inventerait un quota', () => {
    expect(extraireFenetres(enveloppeUsage(REPONSE_REELLE)).map((f) => f.typeFenetre)).toEqual([
      'five_hour',
      'seven_day',
    ]);
  });
});

describe('sonde HTTP — jeton expiré', () => {
  test('☠ aucun appel réseau, et un échec EXPLICITE plutôt qu’un 0 % inventé', async () => {
    const [mesure] = await sonderQuotasHttp(
      [{ compteId: 'compte-a', jetonAcces: 'peu-importe', expireA: 1_000 }],
      2_000,
    );
    expect(mesure?.echec).toContain('expiré');
    expect(mesure?.fenetres).toHaveLength(0);
  });
});
