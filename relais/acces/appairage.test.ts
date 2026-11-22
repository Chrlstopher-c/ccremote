import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Registre } from '../registre/registre.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Acces } from './acces.ts';
import { DUREE_CODE_MS, empreinteCode, nouveauCode, normaliserCode } from './appairage.ts';
import { routesAcces } from './api-acces.ts';
import { MAX_ECHECS_GLOBAL, PlafondEchecs } from './plafond.ts';

const journal = pino({ level: 'silent' });
const FORME_CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;
const serveur = { requestIP: () => ({ address: '192.0.2.9' }) };
let empreinteMotDePasse = '';

beforeAll(async () => {
  empreinteMotDePasse = await Bun.password.hash('bon', { algorithm: 'bcrypt', cost: 4 });
});

function fabrique(): { registre: Registre; acces: Acces } {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const fichier = join(mkdtempSync(join(tmpdir(), 'relais-appairage-')), 'echecs.json');
  const acces = new Acces(registre, empreinteMotDePasse, new PlafondEchecs(fichier, journal));
  return { registre, acces };
}

function requete(chemin: string, corps: unknown, jeton?: string): Request {
  const entetes: Record<string, string> = { 'content-type': 'application/json' };
  if (jeton) entetes['authorization'] = `Bearer ${jeton}`;
  return new Request(`http://relais.test${chemin}`, {
    method: 'POST',
    headers: entetes,
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
}

type Gestion = (req: Request & { params: Record<string, string> }, s: typeof serveur) => Promise<Response> | Response;
function route(acces: Acces, chemin: string): Gestion {
  const table = routesAcces(acces, journal) as unknown as Record<string, Record<string, Gestion>>;
  const h = table[chemin]?.['POST'];
  if (!h) throw new Error(`route absente : POST ${chemin}`);
  return h;
}

describe('code d’appairage', () => {
  test('un code a la forme XXXX-XXXX sans caractères ambigus', () => {
    for (let i = 0; i < 50; i++) expect(nouveauCode()).toMatch(FORME_CODE);
  });

  test('la normalisation ignore la casse, les tirets et les espaces', () => {
    expect(normaliserCode(' ab2c-d3ef ')).toBe('AB2CD3EF');
    expect(empreinteCode('ab2c d3ef')).toBe(empreinteCode('AB2C-D3EF'));
  });

  test('durée de vie : 10 minutes', () => {
    expect(DUREE_CODE_MS).toBe(10 * 60 * 1000);
  });
});

describe('échange du code contre une clé d’appareil', () => {
  test('un code neuf donne une clé d’appareil reconnue par l’API', () => {
    const { acces } = fabrique();
    const { code } = acces.creerCodeAppairage('tour');
    const r = acces.appairer(code, 'iPhone', '192.0.2.9');
    expect(r.ok).toBe(true);
    if (r.ok) expect(acces.genreDuJeton(r.jeton)).toBe('appareil');
  });

  test('le code est à usage unique', () => {
    const { acces } = fabrique();
    const { code } = acces.creerCodeAppairage('tour');
    expect(acces.appairer(code, 'iPhone', '192.0.2.9').ok).toBe(true);
    expect(acces.appairer(code, 'iPad', '192.0.2.9')).toEqual({ ok: false, raison: 'refuse' });
  });

  test('un code expiré est refusé', () => {
    const { registre, acces } = fabrique();
    const expire = new Date(Date.now() - 1000).toISOString();
    registre.creerCodeAppairage(empreinteCode('ABCD-EFGH'), expire, 'tour');
    expect(acces.appairer('ABCD-EFGH', 'iPhone', '192.0.2.9')).toEqual({ ok: false, raison: 'refuse' });
  });

  test('un mauvais code compte comme un échec de connexion de cette adresse', () => {
    const { acces } = fabrique();
    const { code } = acces.creerCodeAppairage('tour');
    for (let i = 0; i < 5; i++) acces.appairer('ZZZZ-ZZZZ', 'x', '192.0.2.9');
    expect(acces.appairer(code, 'iPhone', '192.0.2.9')).toEqual({ ok: false, raison: 'trop_de_tentatives' });
    expect(acces.appairer(code, 'iPhone', '192.0.2.10').ok).toBe(true);
  });

  test('le plafond global d’échecs bloque aussi l’appairage', () => {
    const { acces } = fabrique();
    for (let i = 0; i < MAX_ECHECS_GLOBAL; i++) acces.appairer('ZZZZ-ZZZZ', `ip-${i}`, `ip-${i}`);
    expect(acces.appairer('ZZZZ-ZZZZ', 'neuve', '192.0.2.99')).toEqual({ ok: false, raison: 'trop_de_tentatives' });
  });
});

describe('routes d’appairage', () => {
  test('créer un code exige un appareil connecté : sans clé 401, avec un accès Claude 403', async () => {
    const { acces } = fabrique();
    const creer = route(acces, '/api/appareils/codes');
    expect((await creer(requete('/api/appareils/codes', {}) as never, serveur)).status).toBe(401);
    const mcp = acces.emettre({ nom: 'mcp-test', genre: 'claude-code', jours: 1 });
    expect((await creer(requete('/api/appareils/codes', {}, mcp.jeton) as never, serveur)).status).toBe(403);
  });

  test('un appareil connecté crée un code, qui s’échange contre une clé utilisable', async () => {
    const { acces } = fabrique();
    const amorce = acces.creerCodeAppairage('amorce');
    const amorcee = acces.appairer(amorce.code, 'tour', '192.0.2.9');
    if (!amorcee.ok) throw new Error('amorce refusée');
    const cree = await route(acces, '/api/appareils/codes')(
      requete('/api/appareils/codes', {}, amorcee.jeton) as never,
      serveur,
    );
    expect(cree.status).toBe(201);
    const { code } = (await cree.json()) as { code: string };
    const echange = await route(acces, '/api/appareils/appairer')(
      requete('/api/appareils/appairer', { code, nom: 'iPhone' }) as never,
      serveur,
    );
    expect(echange.status).toBe(200);
    const { cle } = (await echange.json()) as { cle: string };
    expect(acces.genreDuJeton(cle)).toBe('appareil');
  });

  test('l’échange refuse un corps invalide et un mauvais code', async () => {
    const { acces } = fabrique();
    const appairer = route(acces, '/api/appareils/appairer');
    expect((await appairer(requete('/api/appareils/appairer', { code: 'X' }) as never, serveur)).status).toBe(400);
    const mauvais = await appairer(
      requete('/api/appareils/appairer', { code: 'AAAA-BBBB', nom: 'x' }) as never,
      serveur,
    );
    expect(mauvais.status).toBe(401);
  });
});
