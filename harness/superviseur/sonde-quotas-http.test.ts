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

describe('☠ les comptes sont sondés UN PAR UN (vécu 25→31/07)', () => {
  test('deux requêtes ne sont jamais en vol ensemble — l’endpoint en rejetait une, toujours la même', async () => {
    const vraiFetch = globalThis.fetch;
    let enVol = 0;
    let maxEnVol = 0;
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request): Promise<Response> => {
      urls.push(String(url));
      enVol += 1;
      maxEnVol = Math.max(maxEnVol, enVol);
      await new Promise((r) => setTimeout(r, 5));
      enVol -= 1;
      return new Response(JSON.stringify(REPONSE_REELLE), { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      const mesures = await sonderQuotasHttp(
        [
          { compteId: 'compte-a', jetonAcces: 'a', expireA: 9_999_999_999_999 },
          { compteId: 'compte-b', jetonAcces: 'b', expireA: 9_999_999_999_999 },
        ],
        1_000,
        false,
      );
      expect(mesures).toHaveLength(2);
      // Le défaut vécu : `Promise.all` ⇒ 2 (ou 4 avec le profil) requêtes d'un coup.
      expect(maxEnVol).toBe(1);
      // `avecProfil: false` ⇒ aucune requête vers /profile, qui doublait le trafic.
      expect(urls.filter((u) => u.includes('profile'))).toHaveLength(0);
    } finally {
      globalThis.fetch = vraiFetch;
    }
  });
});
