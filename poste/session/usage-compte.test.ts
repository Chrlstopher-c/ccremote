import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { UsageComptes, type SessionUsage } from './usage-compte.ts';

const journal = pino({ enabled: false });
const REPONSE = {
  session: { total_cost_usd: 1.5 },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: null,
  behaviors: null,
};

interface OptionsSession {
  readonly vivante?: boolean;
  readonly appels?: { n: number };
  readonly echec?: boolean;
}

function session(id: string, compte: string, opts: OptionsSession): SessionUsage {
  return {
    resume: { id, compte },
    vivante: opts.vivante ?? true,
    usageSdk: async () => {
      if (opts.appels) opts.appels.n += 1;
      if (opts.echec) throw new Error('requête fermée');
      return REPONSE;
    },
  };
}

describe('usage d’un compte lu sur la session SDK', () => {
  test('première session vivante du compte qui porte une requête SDK', async () => {
    const liste = [
      session('dehors', 'autre', {}),
      { resume: { id: 'arret', compte: 'principal' }, vivante: false },
      session('ouverte', 'principal', {}),
    ];
    const u = new UsageComptes(() => liste, journal);
    const r = await u.lire('principal');
    expect(r).toMatchObject({ sessionId: 'ouverte', abonnement: 'max', session: { total_cost_usd: 1.5 } });
    expect(r?.luLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('aucune session vivante : la dernière lecture reste rendue, datée ; jamais lue : null', async () => {
    let t = 0;
    const liste: SessionUsage[] = [];
    const u = new UsageComptes(() => liste, journal, () => t);
    expect(await u.lire('principal')).toBeNull();
    liste.push(session('nouvelle', 'principal', {}));
    const lue = await u.lire('principal');
    expect(lue?.sessionId).toBe('nouvelle');
    liste.length = 0;
    t += 10 * 60_000;
    expect(await u.lire('principal')).toEqual(lue);
    expect(await u.lire('autre')).toBeNull();
  });

  test('cache de 5 min par compte : une seule lecture du SDK dans ce délai', async () => {
    let t = 0;
    const appels = { n: 0 };
    const liste = [session('s1', 'principal', { appels })];
    const u = new UsageComptes(() => liste, journal, () => t);
    await u.lire('principal');
    t += 4 * 60_000;
    await u.lire('principal');
    expect(appels.n).toBe(1);
    t += 2 * 60_000;
    await u.lire('principal');
    expect(appels.n).toBe(2);
  });

  test('appels concurrents : une seule requête', async () => {
    const appels = { n: 0 };
    const u = new UsageComptes(() => [session('s1', 'principal', { appels })], journal);
    await Promise.all([u.lire('principal'), u.lire('principal')]);
    expect(appels.n).toBe(1);
  });

  test('requête SDK en échec : null, sans exception', async () => {
    const u = new UsageComptes(() => [session('s1', 'principal', { echec: true })], journal);
    expect(await u.lire('principal')).toBeNull();
  });
});
