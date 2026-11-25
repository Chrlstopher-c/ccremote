import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chargerConfig, parserEcoute, urlPostePour } from './config.ts';

// Toutes les variables du relais et du poste : une session lancée depuis Noctis en porte (elles fausseraient la config).
const PREFIXE_VARIABLE = /^(CCREMOTE|LANTERNE|QUART)_/;
const sauvegarde = new Map<string, string | undefined>();

beforeEach(() => {
  sauvegarde.clear();
  for (const v of Object.keys(process.env).filter((cle) => PREFIXE_VARIABLE.test(cle))) {
    sauvegarde.set(v, process.env[v]);
    delete process.env[v];
  }
  process.env['CCREMOTE_EMPREINTE_MOT_DE_PASSE'] = 'empreinte-de-test';
  process.env['CCREMOTE_SECRETS_POSTES'] = 'tour=secret';
});

afterEach(() => {
  for (const v of Object.keys(process.env).filter((cle) => PREFIXE_VARIABLE.test(cle))) delete process.env[v];
  for (const [v, valeur] of sauvegarde) {
    if (valeur !== undefined) process.env[v] = valeur;
  }
});

test('parserEcoute lit des hôtes IPv4 et IPv6 avec leur port', () => {
  expect(parserEcoute('127.0.0.1:8001, [::1]:8002')).toEqual([
    { hote: '127.0.0.1', port: 8001 },
    { hote: '::1', port: 8002 },
  ]);
});

test('parserEcoute refuse une entrée sans port valide', () => {
  expect(() => parserEcoute('127.0.0.1')).toThrow();
  expect(() => parserEcoute('127.0.0.1:0')).toThrow();
  expect(() => parserEcoute('127.0.0.1:abc')).toThrow();
  expect(() => parserEcoute(' ')).toThrow();
});

test('sans variables de relais central : configuration locale inchangée', () => {
  const c = chargerConfig();
  expect(c.central).toBe(false);
  expect(c.ecouteWeb).toEqual([
    { hote: '127.0.0.1', port: 8766 },
    { hote: '::1', port: 8766 },
  ]);
  expect(c.ecoutePostes).toEqual([{ hote: undefined, port: 8721 }]);
  expect(c.boucleWeb).toEqual({ hote: '127.0.0.1', port: 8766 });
  expect(c.secretsPostes.get('tour')).toBe('secret');
});

test('mode central : écoute par adresse, données et secrets sous le dossier de données', () => {
  const donnees = mkdtempSync(join(tmpdir(), 'relais-central-cfg-'));
  process.env['LANTERNE_RELAIS_MODE'] = 'central';
  process.env['LANTERNE_RELAIS_ECOUTE'] = '192.0.2.5:8766,127.0.0.1:8767';
  process.env['LANTERNE_RELAIS_PORT_POSTES'] = '8721';
  process.env['LANTERNE_RELAIS_DONNEES'] = donnees;
  delete process.env['CCREMOTE_SECRETS_POSTES'];
  const c = chargerConfig();
  expect(c.central).toBe(true);
  expect(c.ecouteWeb).toEqual([
    { hote: '192.0.2.5', port: 8766 },
    { hote: '127.0.0.1', port: 8767 },
  ]);
  expect(c.ecoutePostes).toEqual([
    { hote: '192.0.2.5', port: 8721 },
    { hote: '127.0.0.1', port: 8721 },
  ]);
  expect(c.boucleWeb).toEqual({ hote: '127.0.0.1', port: 8767 });
  expect(c.base).toBe(join(donnees, 'relais.db'));
  expect(c.fichierEchecs).toBe(join(donnees, 'echecs-connexion.json'));
  expect(c.dossierSecrets).toBe(join(donnees, 'postes'));
  expect(c.secretsPostes.size).toBe(0);
  expect(c.integre).toBeNull();
});

test('mode central : les données l’emportent sur CCREMOTE_BASE', () => {
  process.env['LANTERNE_RELAIS_MODE'] = 'central';
  process.env['LANTERNE_RELAIS_ECOUTE'] = '127.0.0.1:8767';
  process.env['LANTERNE_RELAIS_DONNEES'] = '/srv/donnees-test';
  process.env['CCREMOTE_BASE'] = '/ailleurs/relais.db';
  expect(chargerConfig().base).toBe('/srv/donnees-test/relais.db');
});

test('mode central sans dossier de données ou sans écoute : refus clair', () => {
  process.env['LANTERNE_RELAIS_MODE'] = 'central';
  process.env['LANTERNE_RELAIS_ECOUTE'] = '127.0.0.1:8767';
  expect(() => chargerConfig()).toThrow('LANTERNE_RELAIS_DONNEES');
  process.env['LANTERNE_RELAIS_DONNEES'] = '/srv/donnees-test';
  delete process.env['LANTERNE_RELAIS_ECOUTE'];
  expect(() => chargerConfig()).toThrow('LANTERNE_RELAIS_ECOUTE');
});

test('mode central : un tunnel intégré (LANTERNE_MOTEUR_PORT_POSTES) est ignoré', () => {
  process.env['LANTERNE_RELAIS_MODE'] = 'central';
  process.env['LANTERNE_RELAIS_ECOUTE'] = '127.0.0.1:8767';
  process.env['LANTERNE_RELAIS_DONNEES'] = '/srv/donnees-test';
  process.env['LANTERNE_MOTEUR_PORT_POSTES'] = '47000';
  expect(chargerConfig().central).toBe(true);
  expect(chargerConfig().ecoutePostes).toEqual([{ hote: '127.0.0.1', port: 8721 }]);
});

test('adresse du lien des postes : première adresse hors boucle, port des postes, sans valeur en dur', () => {
  const ecoute = parserEcoute('127.0.0.1:8767,192.0.2.7:8768');
  expect(urlPostePour(ecoute, 8721)).toBe('ws://192.0.2.7:8721/poste');
  expect(urlPostePour(parserEcoute('[fd00::7]:8767,127.0.0.1:8768'), 8721)).toBe('ws://[fd00::7]:8721/poste');
  expect(urlPostePour(parserEcoute('127.0.0.1:8767,0.0.0.0:8768'), 8721)).toBeNull();
});

test('mode central : le relais connaît l’adresse de son lien des postes ; local : aucune', () => {
  process.env['LANTERNE_RELAIS_MODE'] = 'central';
  process.env['LANTERNE_RELAIS_ECOUTE'] = '127.0.0.1:8767,192.0.2.7:8768';
  process.env['LANTERNE_RELAIS_DONNEES'] = '/srv/donnees-test';
  process.env['LANTERNE_RELAIS_PORT_POSTES'] = '8721';
  expect(chargerConfig().urlPoste).toBe('ws://192.0.2.7:8721/poste');
  delete process.env['LANTERNE_RELAIS_MODE'];
  process.env['CCREMOTE_SECRETS_POSTES'] = 'tour=secret';
  expect(chargerConfig().urlPoste).toBeNull();
});
