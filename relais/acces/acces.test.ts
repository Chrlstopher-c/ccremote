import { beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Registre } from '../registre/registre.ts';
import { ipDe } from '../clients/api.ts';
import { Acces } from './acces.ts';
import { FENETRE_GLOBALE_MS, MAX_ECHECS_GLOBAL, PlafondEchecs } from './plafond.ts';

const journal = pino({ level: 'silent' });
// Seul creerJeton sert à la connexion : le reste du registre n'est pas touché par ces tests.
const registre = { creerJeton: () => undefined } as unknown as Registre;
let empreinte = '';

beforeAll(async () => {
  empreinte = await Bun.password.hash('bon', { algorithm: 'bcrypt', cost: 4 });
});

function fichier(): string {
  return join(mkdtempSync(join(tmpdir(), 'ccremote-acces-')), 'echecs.json');
}

test('par IP : 5 échecs bloquent cette IP, pas les autres', async () => {
  const acces = new Acces(registre, empreinte, new PlafondEchecs(fichier(), journal));
  for (let i = 0; i < 5; i++) expect((await acces.connecter('faux', 'a', 'x')).ok).toBe(false);
  expect(await acces.connecter('bon', 'a', 'x')).toEqual({ ok: false, raison: 'trop_de_tentatives' });
  expect((await acces.connecter('bon', 'b', 'x')).ok).toBe(true);
});

test('global : des échecs répartis sur plusieurs IP bloquent toutes les connexions, même le bon mot de passe', async () => {
  const acces = new Acces(registre, empreinte, new PlafondEchecs(fichier(), journal));
  for (let i = 0; i < MAX_ECHECS_GLOBAL; i++) await acces.connecter('faux', `ip-${i}`, 'x');
  expect(await acces.connecter('bon', 'neuve', 'x')).toEqual({ ok: false, raison: 'trop_de_tentatives' });
});

test('le plafond global survit à un redémarrage et expire avec sa fenêtre', () => {
  const f = fichier();
  let t = 1_000_000;
  const avant = new PlafondEchecs(f, journal, () => t);
  for (let i = 0; i < MAX_ECHECS_GLOBAL; i++) avant.noter();
  expect(new PlafondEchecs(f, journal, () => t).atteint()).toBe(true);
  t += FENETRE_GLOBALE_MS + 1;
  expect(new PlafondEchecs(f, journal, () => t).atteint()).toBe(false);
});

test('un fichier d’échecs corrompu applique le plafond au lieu de le remettre à zéro', () => {
  const f = fichier();
  writeFileSync(f, '{pas du json');
  expect(new PlafondEchecs(f, journal).atteint()).toBe(true);
});

test("l'en-tête d'IP n'est cru que venant de la boucle locale", () => {
  const req = new Request('http://x/', { headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' } });
  expect(ipDe(req, '192.168.1.50')).toBe('192.168.1.50');
  expect(ipDe(req, '127.0.0.1')).toBe('1.2.3.4');
  expect(ipDe(req, '::ffff:127.0.0.1')).toBe('1.2.3.4');
  expect(ipDe(new Request('http://x/', { headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' } }), '::1')).toBe('5.6.7.8');
  expect(ipDe(new Request('http://x/'), '127.0.0.1')).toBe('127.0.0.1');
  expect(ipDe(req, undefined)).toBe('inconnue');
});
