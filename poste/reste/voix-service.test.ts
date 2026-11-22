// Responsabilité : tests du service de voix du poste contre un faux systemctl et une fausse sonde (injectés) : unité
// absente, arrêtée, en chargement, prête, en erreur, démarrer/arrêter, refus si non installé, échecs de systemctl.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { ServiceVoix, type SortieSystemctl } from './voix-service.ts';

const journal = pino({ level: 'silent' });
const DEPUIS = 1_763_632_800;
const DEPUIS_ISO = new Date(DEPUIS * 1000).toISOString();
const URL_VOIX = 'http://voix.test';
const PROPRIETES = '--property=LoadState,ActiveState,ActiveEnterTimestamp';

interface Unite {
  LoadState: string;
  ActiveState: string;
  ActiveEnterTimestamp: string;
}

interface Faux {
  readonly unite: Unite;
  readonly appels: string[][];
  readonly sondes: string[];
  pret: boolean;
  echecAction: string | null;
  lancer: (args: string[]) => Promise<SortieSystemctl>;
  sonder: (url: string) => Promise<boolean>;
}

function faux(unite: Partial<Unite> = {}): Faux {
  const f: Faux = {
    unite: { LoadState: 'loaded', ActiveState: 'inactive', ActiveEnterTimestamp: '', ...unite },
    appels: [],
    sondes: [],
    pret: true,
    echecAction: null,
    lancer: async (args) => {
      f.appels.push(args);
      if (args.includes('show')) {
        const u = f.unite;
        const lignes = [`LoadState=${u.LoadState}`, `ActiveState=${u.ActiveState}`];
        lignes.push(`ActiveEnterTimestamp=${u.ActiveEnterTimestamp}`);
        return { code: 0, sortie: lignes.join('\n'), erreurs: '' };
      }
      if (f.echecAction !== null) return { code: 1, sortie: '', erreurs: f.echecAction };
      f.unite.ActiveState = args.includes('start') ? 'activating' : 'inactive';
      return { code: 0, sortie: '', erreurs: '' };
    },
    sonder: async (url) => {
      f.sondes.push(url);
      return f.pret;
    },
  };
  return f;
}

function service(f: Faux, url: string | null = URL_VOIX): ServiceVoix {
  return new ServiceVoix({ url, journal, lancer: f.lancer, sonder: f.sonder });
}

describe('état du service de voix', () => {
  test('unité non installée : absent avec le message', async () => {
    const f = faux({ LoadState: 'not-found' });
    expect(await service(f).etat()).toEqual({
      installe: false,
      etat: 'absent',
      depuis: null,
      message: 'service de voix non installé sur ce poste',
    });
    expect(f.appels[0]).toEqual(['--user', 'show', 'lanterne-voix', PROPRIETES, '--timestamp=unix']);
  });

  test('arrêtée : arrete, sans date ni sonde', async () => {
    const f = faux({ ActiveState: 'inactive' });
    expect(await service(f).etat()).toEqual({ installe: true, etat: 'arrete', depuis: null, message: null });
    expect(f.sondes).toEqual([]);
  });

  test('active mais modèle pas prêt : demarrage, depuis = entrée en marche', async () => {
    const f = faux({ ActiveState: 'active', ActiveEnterTimestamp: `@${DEPUIS}` });
    f.pret = false;
    const etat = await service(f).etat();
    expect(etat).toMatchObject({ installe: true, etat: 'demarrage', depuis: DEPUIS_ISO });
    expect(f.sondes).toEqual([`${URL_VOIX}`]);
  });

  test('active et sonde /sante OK : pret', async () => {
    const f = faux({ ActiveState: 'active', ActiveEnterTimestamp: `@${DEPUIS}` });
    expect(await service(f).etat()).toEqual({ installe: true, etat: 'pret', depuis: DEPUIS_ISO, message: null });
  });

  test('active sans adresse : pret sans sonder', async () => {
    const f = faux({ ActiveState: 'active', ActiveEnterTimestamp: `@${DEPUIS}` });
    expect((await service(f, null).etat()).etat).toBe('pret');
    expect(f.sondes).toEqual([]);
  });

  test('en activation : demarrage ; en échec : erreur avec son message', async () => {
    expect((await service(faux({ ActiveState: 'activating' })).etat()).etat).toBe('demarrage');
    expect(await service(faux({ ActiveState: 'failed' })).etat()).toEqual({
      installe: true,
      etat: 'erreur',
      depuis: null,
      message: 'le service de voix s’est arrêté sur une erreur',
    });
  });

  test('systemctl en échec ou lanceur qui lève : erreur, jamais une exception', async () => {
    const f = faux();
    f.lancer = async () => ({ code: 1, sortie: '', erreurs: 'bus indisponible' });
    expect((await service(f).etat()).etat).toBe('erreur');
    const g = new ServiceVoix({
      url: null,
      journal,
      lancer: async () => {
        throw new Error('systemctl absent');
      },
    });
    expect(await g.etat()).toMatchObject({ installe: false, etat: 'erreur' });
  });
});

describe('démarrer et arrêter', () => {
  test('démarrer : systemctl start sans attendre, état relu', async () => {
    const f = faux({ ActiveState: 'inactive' });
    const r = await service(f).piloter('demarrer');
    expect(f.appels).toContainEqual(['--user', 'start', '--no-block', 'lanterne-voix']);
    expect(r).toMatchObject({ ok: true, etat: { installe: true, etat: 'demarrage', depuis: null } });
  });

  test('arrêter : systemctl stop sans attendre, état relu', async () => {
    const f = faux({ ActiveState: 'active', ActiveEnterTimestamp: `@${DEPUIS}` });
    const r = await service(f).piloter('arreter');
    expect(f.appels).toContainEqual(['--user', 'stop', '--no-block', 'lanterne-voix']);
    expect(r).toEqual({ ok: true, etat: { installe: true, etat: 'arrete', depuis: null, message: null } });
  });

  test('échec de systemctl : la dernière ligne d’erreur, sans état changé', async () => {
    const f = faux({ ActiveState: 'inactive' });
    f.echecAction = 'Job failed\nFailed to start lanterne-voix';
    expect(await service(f).piloter('demarrer')).toEqual({ ok: false, erreur: 'Failed to start lanterne-voix' });
  });

  test('non installé : refus, aucune action lancée', async () => {
    const f = faux({ LoadState: 'not-found' });
    expect(await service(f).piloter('demarrer')).toEqual({
      ok: false,
      erreur: 'service de voix non installé sur ce poste',
    });
    expect(f.appels.some((a) => a.includes('start'))).toBe(false);
  });
});
