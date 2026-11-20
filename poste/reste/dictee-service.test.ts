// Responsabilité : tests du service de dictée du poste (pilotage) contre un faux moteur (lanceur injecté, état tenu en
// mémoire) : script absent, découverte, démarrer/arrêter, pid mémorisé seulement pour un moteur lancé ici, arrêt après
// inactivité, réglages persistés, et le lanceur réel sur un script jetable.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { type ActionMoteur, decouvrirScript, lancerMoteur, type LanceurMoteur } from './dictee-moteur.ts';
import { ServiceMoteurDictee } from './dictee-service.ts';

const journal = pino({ level: 'silent' });
const DEBUT = Date.parse('2026-11-20T10:00:00.000Z');
const MINUTE = 60_000;
const SCRIPT = '/faux/moteur.sh';
const RUN = '/faux/run';

interface Appel {
  readonly script: string;
  readonly action: ActionMoteur;
  readonly dossierRun: string;
}

// Faux moteur : `demarrer` met l'état à « pret » avec un pid neuf (sauf s'il tourne déjà), `arreter` l'éteint.
class MoteurFaux {
  etat: 'arrete' | 'pret' = 'arrete';
  pid: number | null = null;
  prochainPid = 100;
  echecDemarrage: string | null = null;
  readonly appels: Appel[] = [];

  readonly lancer: LanceurMoteur = async (script, action, dossierRun) => {
    this.appels.push({ script, action, dossierRun });
    if (action === 'demarrer') return this.demarrer();
    if (action === 'arreter') {
      this.etat = 'arrete';
      this.pid = null;
      return { code: 0, sortie: 'moteur arrêté', erreurs: '' };
    }
    return { code: 0, sortie: JSON.stringify(this.lire()), erreurs: '' };
  };

  /** Le moteur est lancé par quelqu'un d'autre (start.sh de Chris). */
  lancerAilleurs(pid: number): void {
    this.etat = 'pret';
    this.pid = pid;
  }

  private demarrer(): { code: number; sortie: string; erreurs: string } {
    if (this.echecDemarrage !== null) return { code: 1, sortie: '', erreurs: this.echecDemarrage };
    if (this.etat === 'arrete') {
      this.etat = 'pret';
      this.pid = this.prochainPid++;
    }
    return { code: 0, sortie: `moteur lancé (pid ${this.pid})`, erreurs: '' };
  }

  private lire(): Record<string, unknown> {
    const actif = this.etat === 'pret';
    return {
      etat: this.etat,
      pid: this.pid,
      depuis: actif ? '2026-11-20T10:00:00Z' : null,
      chargementMs: actif ? 1200 : null,
      memoireGpuMo: actif ? 4096 : null,
      message: null,
    };
  }
}

let dossier = '';
let horloge = DEBUT;
let moteur: MoteurFaux;

function service(script: string | null = SCRIPT): ServiceMoteurDictee {
  return new ServiceMoteurDictee({
    script,
    dossierRun: RUN,
    fichierReglages: join(dossier, 'dictee-service.json'),
    journal,
    lancer: moteur.lancer,
    horloge: () => new Date(horloge),
  });
}

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'dictee-service-'));
});

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(dossier, 'dictee-service.json'), { force: true });
  horloge = DEBUT;
  moteur = new MoteurFaux();
});

describe('découverte du script', () => {
  test('variable explicite prioritaire ; absente du disque = non installé', () => {
    const existe = (c: string) => c === '/opt/moteur.sh';
    expect(decouvrirScript({ LANTERNE_DICTEE_SCRIPT: '/opt/moteur.sh' }, '/h', existe)).toBe('/opt/moteur.sh');
    expect(decouvrirScript({ LANTERNE_DICTEE_SCRIPT: '/ailleurs.sh' }, '/h', existe)).toBeNull();
  });

  test('sinon le premier candidat existant ; rien d’existant = null', () => {
    const sous = join('/h', 'projects', 'whisper', 'app', 'moteur.sh');
    expect(decouvrirScript({}, '/h', (c) => c === sous)).toBe(sous);
    expect(decouvrirScript({}, '/h', (c) => c === '/mnt/projects/whisper/app/moteur.sh')).toBe(
      '/mnt/projects/whisper/app/moteur.sh',
    );
    expect(decouvrirScript({}, '/h', () => false)).toBeNull();
  });
});

describe('script absent', () => {
  test('état « absent » avec le message, et aucune action possible', async () => {
    const s = service(null);
    expect(await s.etat()).toMatchObject({
      installe: false,
      etat: 'absent',
      lanceParPoste: false,
      message: 'service de dictée non installé sur ce poste',
    });
    expect(await s.piloter('demarrer')).toEqual({
      ok: false,
      erreur: 'service de dictée non installé sur ce poste',
    });
    expect(moteur.appels.length).toBe(0);
  });
});

describe('démarrer et arrêter', () => {
  test('le script reçoit l’action et DICTEE_RUN ; le pid est mémorisé pour un moteur lancé ici', async () => {
    const r = await service().piloter('demarrer');
    expect(moteur.appels.find((a) => a.action === 'demarrer')).toEqual({
      script: SCRIPT,
      action: 'demarrer',
      dossierRun: RUN,
    });
    expect(r).toMatchObject({
      ok: true,
      etat: { installe: true, etat: 'pret', lanceParPoste: true, arretInactiviteMin: 15 },
    });
    const persiste = JSON.parse(readFileSync(join(dossier, 'dictee-service.json'), 'utf8')) as Record<string, unknown>;
    expect(persiste['pidLance']).toBe(100);
  });

  test('moteur déjà en marche (start.sh) : démarrer ne le revendique pas', async () => {
    moteur.lancerAilleurs(4242);
    const r = await service().piloter('demarrer');
    expect(r).toMatchObject({ ok: true, etat: { lanceParPoste: false } });
  });

  test('arrêter éteint le moteur et oublie le pid', async () => {
    const s = service();
    await s.piloter('demarrer');
    const r = await s.piloter('arreter');
    expect(r).toMatchObject({ ok: true, etat: { etat: 'arrete', lanceParPoste: false } });
    expect(moteur.appels.some((a) => a.action === 'arreter')).toBe(true);
  });

  test('échec du script : raison = dernière ligne d’erreur, moteur inchangé', async () => {
    moteur.echecDemarrage = 'trace\nPython du moteur introuvable : /x/python';
    const r = await service().piloter('demarrer');
    expect(r).toEqual({ ok: false, erreur: 'Python du moteur introuvable : /x/python' });
  });
});

describe('arrêt après inactivité', () => {
  test('un moteur lancé ici s’arrête après la durée sans transcription, pas avant', async () => {
    const s = service();
    await s.piloter('demarrer');
    horloge = DEBUT + 14 * MINUTE;
    await s.verifierInactivite();
    expect(moteur.etat).toBe('pret');
    horloge = DEBUT + 16 * MINUTE;
    await s.verifierInactivite();
    expect(moteur.etat).toBe('arrete');
  });

  test('une transcription repousse l’arrêt et mesure la latence', async () => {
    const s = service();
    await s.piloter('demarrer');
    horloge = DEBUT + 10 * MINUTE;
    s.noterTranscription(850);
    horloge = DEBUT + 20 * MINUTE;
    await s.verifierInactivite();
    expect(moteur.etat).toBe('pret');
    expect(await s.etat()).toMatchObject({
      latenceMs: 850,
      derniereActivite: new Date(DEBUT + 10 * MINUTE).toISOString(),
    });
    horloge = DEBUT + 26 * MINUTE;
    await s.verifierInactivite();
    expect(moteur.etat).toBe('arrete');
  });

  test('un moteur lancé par quelqu’un d’autre n’est jamais arrêté', async () => {
    moteur.lancerAilleurs(4242);
    const s = service();
    horloge = DEBUT + 600 * MINUTE;
    await s.verifierInactivite();
    expect(moteur.etat).toBe('pret');
    expect(moteur.appels.some((a) => a.action === 'arreter')).toBe(false);
  });

  test('durée 0 : jamais d’arrêt automatique', async () => {
    const s = service();
    await s.piloter('regler', 0);
    await s.piloter('demarrer');
    horloge = DEBUT + 600 * MINUTE;
    await s.verifierInactivite();
    expect(moteur.etat).toBe('pret');
  });
});

describe('réglages', () => {
  test('régler sans durée : refusé', async () => {
    expect(await service().piloter('regler')).toEqual({ ok: false, erreur: 'durée d’arrêt attendue' });
  });

  test('la durée réglée est persistée et relue par un nouveau service', async () => {
    await service().piloter('regler', 30);
    expect(await service().etat()).toMatchObject({ arretInactiviteMin: 30 });
    expect(moteur.appels.some((a) => a.action === 'demarrer' || a.action === 'arreter')).toBe(false);
  });

  test('fichier de réglages illisible : valeurs par défaut', async () => {
    writeFileSync(join(dossier, 'dictee-service.json'), '{ pas du json');
    expect(await service().etat()).toMatchObject({ arretInactiviteMin: 15 });
  });
});

describe('lanceur réel', () => {
  test('exécute le script avec l’action et DICTEE_RUN, sans shell', async () => {
    const jetable = join(dossier, 'faux-moteur.sh');
    writeFileSync(jetable, '#!/bin/sh\nprintf "%s|%s" "$1" "$DICTEE_RUN"\n');
    chmodSync(jetable, 0o755);
    const r = await lancerMoteur(jetable, 'arreter', '/x/run');
    expect(r).toEqual({ code: 0, sortie: 'arreter|/x/run', erreurs: '' });
  });
});
