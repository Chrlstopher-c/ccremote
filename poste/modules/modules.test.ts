// Responsabilité : tests du poste pour les modules — validation d'un dossier, puis envoi au relais (une fois par
// rafale, remplacement, retrait, erreur). Données temporaires seulement.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { MessagePoste } from '../../commun/protocole-poste.ts';
import { FICHIERS_MAX_MODULE, TAILLE_MAX_MODULE } from '../../commun/modules.ts';
import { validerModule } from './validation.ts';
import { SurveillanceModules } from './surveillance.ts';

const journal = pino({ enabled: false });

function manifeste(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    nom: 'Carte',
    version: '1.0.0',
    description: 'Test',
    icone: 'map',
    point: 'index.js',
    emplacements: ['panneau'],
    ...extra,
  });
}

function ecrireModule(racine: string, id: string, index = 'export default function activer() {}'): string {
  const dossier = join(racine, id);
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'module.json'), manifeste(id));
  writeFileSync(join(dossier, 'index.js'), index);
  return dossier;
}

let racine = '';

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'quart-modules-poste-'));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe('validation d’un module', () => {
  test('un module valide donne ses fichiers et une empreinte de 64 caractères hexadécimaux', () => {
    ecrireModule(racine, 'carte');
    const r = validerModule(join(racine, 'carte'), 'carte');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.module.fichiers.map((f) => f.chemin).sort()).toEqual(['index.js', 'module.json']);
    expect(r.module.empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  test('l’empreinte change avec le contenu d’un fichier', () => {
    const dossier = ecrireModule(racine, 'carte');
    const avant = validerModule(dossier, 'carte');
    writeFileSync(join(dossier, 'index.js'), 'export default function activer() { return 1; }');
    const apres = validerModule(dossier, 'carte');
    expect(avant.ok && apres.ok && avant.module.empreinte !== apres.module.empreinte).toBe(true);
  });

  test('un id de manifeste différent du nom du dossier est refusé', () => {
    const dossier = ecrireModule(racine, 'carte');
    writeFileSync(join(dossier, 'module.json'), manifeste('autre'));
    const r = validerModule(dossier, 'carte');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('nom du dossier');
  });

  test('un nom de dossier non conforme est refusé', () => {
    const dossier = ecrireModule(racine, 'Carte Pro');
    const r = validerModule(dossier, 'Carte Pro');
    expect(r.ok).toBe(false);
  });

  test('un manifeste invalide (zod) ou non JSON est refusé', () => {
    const dossier = ecrireModule(racine, 'carte');
    writeFileSync(join(dossier, 'module.json'), '{"id":"carte"}');
    expect(validerModule(dossier, 'carte').ok).toBe(false);
    writeFileSync(join(dossier, 'module.json'), '{pas du json');
    expect(validerModule(dossier, 'carte').ok).toBe(false);
  });

  test('un point absent ou un point qui sort du dossier est refusé', () => {
    const dossier = ecrireModule(racine, 'carte');
    writeFileSync(join(dossier, 'module.json'), manifeste('carte', { point: 'absent.js' }));
    expect(validerModule(dossier, 'carte').ok).toBe(false);
    writeFileSync(join(dossier, 'module.json'), manifeste('carte', { point: '../index.js' }));
    expect(validerModule(dossier, 'carte').ok).toBe(false);
  });

  test('un lien symbolique est refusé', () => {
    const dossier = ecrireModule(racine, 'carte');
    symlinkSync(join(racine, 'carte', 'index.js'), join(dossier, 'lien.js'));
    const r = validerModule(dossier, 'carte');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('lien symbolique');
  });

  test('plus de 200 fichiers ou plus de 2 Mo sont refusés', () => {
    const dossier = ecrireModule(racine, 'carte');
    for (let i = 0; i <= FICHIERS_MAX_MODULE; i++) writeFileSync(join(dossier, `f${i}.txt`), 'x');
    expect(validerModule(dossier, 'carte').ok).toBe(false);
    rmSync(dossier, { recursive: true, force: true });
    const lourd = ecrireModule(racine, 'lourd', 'x'.repeat(TAILLE_MAX_MODULE + 1));
    expect(validerModule(lourd, 'lourd').ok).toBe(false);
  });
});

describe('limites v1.2 et partie serveur à la validation', () => {
  test('un module de 15 Mo est accepté, un module de 25 Mo est refusé', () => {
    const juste = ecrireModule(racine, 'juste', 'x'.repeat(15 * 1024 * 1024));
    expect(validerModule(juste, 'juste').ok).toBe(true);
    const trop = ecrireModule(racine, 'trop', 'x'.repeat(25 * 1024 * 1024));
    const r = validerModule(trop, 'trop');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('20 Mo');
  });

  test('serveur/node_modules n’entre ni dans les fichiers ni dans l’empreinte', () => {
    const dossier = ecrireModule(racine, 'carte');
    writeFileSync(join(dossier, 'module.json'), manifeste('carte', { serveur: { point: 'serveur/index.ts' } }));
    mkdirSync(join(dossier, 'serveur', 'node_modules', 'paquet'), { recursive: true });
    writeFileSync(join(dossier, 'serveur', 'index.ts'), 'export {};');
    const avant = validerModule(dossier, 'carte');
    writeFileSync(join(dossier, 'serveur', 'node_modules', 'paquet', 'index.js'), 'x'.repeat(1000));
    const apres = validerModule(dossier, 'carte');
    expect(apres.ok).toBe(true);
    if (!apres.ok || !avant.ok) return;
    expect(apres.module.fichiers.some((f) => f.chemin.includes('node_modules'))).toBe(false);
    expect(apres.module.empreinte).toBe(avant.module.empreinte);
  });

  test('un serveur dont le point est absent est refusé', () => {
    const dossier = ecrireModule(racine, 'carte');
    writeFileSync(join(dossier, 'module.json'), manifeste('carte', { serveur: { point: 'serveur/index.ts' } }));
    const r = validerModule(dossier, 'carte');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain('serveur introuvable');
  });
});

describe('synchronisation vers le relais', () => {
  const envois: MessagePoste[] = [];
  let surveillance: SurveillanceModules | null = null;

  function demarrer(): SurveillanceModules {
    surveillance = new SurveillanceModules({
      dossier: racine,
      envoyer: (m) => envois.push(m),
      journal,
      delaiMs: 40,
      periodeMs: 60_000,
    });
    surveillance.demarrer();
    return surveillance;
  }

  function messages(kind: MessagePoste['kind']): MessagePoste[] {
    return envois.filter((m) => m.kind === kind);
  }

  beforeEach(() => {
    envois.length = 0;
  });

  afterEach(() => {
    surveillance?.arreter();
    surveillance = null;
  });

  test('une rafale d’écritures d’un module part une seule fois, dans sa version finale', async () => {
    demarrer();
    const dossier = join(racine, 'carte');
    mkdirSync(dossier);
    writeFileSync(join(dossier, 'module.json'), manifeste('carte'));
    for (let i = 0; i < 5; i++) writeFileSync(join(dossier, 'index.js'), `export const v = ${i};`);
    await Bun.sleep(300);
    const envoyes = messages('module');
    expect(envoyes).toHaveLength(1);
    const attendu = validerModule(dossier, 'carte');
    const premier = envoyes[0];
    expect(premier?.kind === 'module' && attendu.ok && premier.empreinte === attendu.module.empreinte).toBe(true);
    if (premier?.kind === 'module') {
      expect(premier.fichiers.find((f) => f.chemin === 'index.js')?.base64).toBe(
        Buffer.from('export const v = 4;').toString('base64'),
      );
    }
  });

  test('une modification envoie une nouvelle empreinte, puis une suppression envoie module_retire', async () => {
    const dossier = ecrireModule(racine, 'carte');
    demarrer();
    surveillance?.synchroniser();
    expect(messages('module')).toHaveLength(1);
    writeFileSync(join(dossier, 'index.js'), 'export const nouveau = true;');
    await Bun.sleep(300);
    expect(messages('module')).toHaveLength(2);
    rmSync(dossier, { recursive: true, force: true });
    await Bun.sleep(300);
    expect(messages('module_retire')).toEqual([{ kind: 'module_retire', id: 'carte' }]);
  });

  test('un état inchangé ne renvoie rien', () => {
    ecrireModule(racine, 'carte');
    const s = demarrer();
    s.synchroniser();
    s.synchroniser();
    expect(messages('module')).toHaveLength(1);
  });

  test('un module invalide n’envoie pas de module mais une module_erreur', () => {
    const dossier = ecrireModule(racine, 'carte');
    writeFileSync(join(dossier, 'module.json'), manifeste('autre'));
    demarrer().synchroniser();
    expect(messages('module')).toHaveLength(0);
    expect(messages('module_erreur')).toHaveLength(1);
  });

  test('un dossier des modules absent ne crée rien et n’envoie rien', () => {
    const absent = join(racine, 'inexistant');
    surveillance = new SurveillanceModules({
      dossier: absent,
      envoyer: (m) => envois.push(m),
      journal,
      delaiMs: 40,
      periodeMs: 60_000,
    });
    surveillance.demarrer();
    expect(existsSync(absent)).toBe(false);
    expect(envois).toHaveLength(0);
  });
});
