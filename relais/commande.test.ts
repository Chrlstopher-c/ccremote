import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chargerConfig } from './config.ts';
import { executer, jetonPoste } from './commande.ts';

const VARIABLES = [
  'LANTERNE_RELAIS_MODE',
  'LANTERNE_RELAIS_ECOUTE',
  'LANTERNE_RELAIS_DONNEES',
  'CCREMOTE_EMPREINTE_MOT_DE_PASSE',
];
const sauvegarde = new Map<string, string | undefined>();
let donnees = '';

beforeEach(() => {
  for (const v of VARIABLES) {
    sauvegarde.set(v, process.env[v]);
    delete process.env[v];
  }
  donnees = mkdtempSync(join(tmpdir(), 'relais-commande-'));
  process.env['LANTERNE_RELAIS_MODE'] = 'central';
  process.env['LANTERNE_RELAIS_ECOUTE'] = '127.0.0.1:8767';
  process.env['LANTERNE_RELAIS_DONNEES'] = donnees;
  process.env['CCREMOTE_EMPREINTE_MOT_DE_PASSE'] = 'empreinte-de-test';
});

afterEach(() => {
  for (const v of VARIABLES) {
    const valeur = sauvegarde.get(v);
    if (valeur === undefined) delete process.env[v];
    else process.env[v] = valeur;
  }
});

test('jeton-poste émet un secret 600 et rend la config du poste avec ce secret', () => {
  const dossier = join(donnees, 'postes');
  const sortie = jetonPoste(dossier, 'tour', 'ws://192.0.2.5:8721/poste');
  const secret = readFileSync(join(dossier, 'tour.secret'), 'utf8').trim();
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  expect(statSync(join(dossier, 'tour.secret')).mode & 0o777).toBe(0o600);
  expect(sortie.posteEnv).toContain(`CCREMOTE_SECRET_POSTE=${secret}`);
  expect(JSON.parse(sortie.posteJson)).toMatchObject({ machine: 'tour', relais: 'ws://192.0.2.5:8721/poste' });
});

test('jeton-poste refuse un poste qui a déjà un secret (pas de renouvellement silencieux)', () => {
  const dossier = join(donnees, 'postes');
  jetonPoste(dossier, 'portable', 'ws://192.0.2.5:8721/poste');
  const avant = readFileSync(join(dossier, 'portable.secret'), 'utf8');
  expect(() => jetonPoste(dossier, 'portable', 'ws://192.0.2.5:8721/poste')).toThrow('déjà');
  expect(readFileSync(join(dossier, 'portable.secret'), 'utf8')).toBe(avant);
});

test('jeton-poste refuse un identifiant de poste ou une adresse de relais invalides', () => {
  const dossier = join(donnees, 'postes');
  expect(() => jetonPoste(dossier, 'Tour !', 'ws://192.0.2.5:8721/poste')).toThrow();
  expect(() => jetonPoste(dossier, 'tour', 'http://192.0.2.5:8721/poste')).toThrow();
  expect(existsSync(join(dossier, 'tour.secret'))).toBe(false);
});

test('appairer affiche un code neuf, dans le format du relais', () => {
  const config = chargerConfig();
  const sortie = executer(['appairer'], config);
  expect(sortie.split('\n')[0]).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
});

test('une commande inconnue ou absente est refusée avec l’aide', () => {
  const config = chargerConfig();
  expect(() => executer([], config)).toThrow('appairer');
  expect(() => executer(['inconnue'], config)).toThrow('appairer');
});
