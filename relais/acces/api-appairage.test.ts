import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Registre } from '../registre/registre.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Acces } from './acces.ts';
import { empreinteCode } from './appairage.ts';
import { type Gestionnaire, type PosteRelais, routesAppairage } from './api-appairage.ts';
import { PlafondEchecs } from './plafond.ts';

const journal = pino({ level: 'silent' });
const serveur = { requestIP: () => ({ address: '192.0.2.9' }) };
const URL_POSTE = 'ws://192.0.2.5:8721/poste';
let empreinteMotDePasse = '';

beforeAll(async () => {
  empreinteMotDePasse = await Bun.password.hash('bon', { algorithm: 'bcrypt', cost: 4 });
});

interface Banc {
  readonly registre: Registre;
  readonly acces: Acces;
  readonly secrets: Map<string, string>;
  readonly coupees: string[];
  readonly poste: PosteRelais;
}

function banc(urlPoste: string | null = URL_POSTE): Banc {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const dossier = join(mkdtempSync(join(tmpdir(), 'appairage-poste-')), 'postes');
  const acces = new Acces(registre, empreinteMotDePasse, new PlafondEchecs(join(dossier, 'echecs.json'), journal));
  const secrets = new Map<string, string>();
  const coupees: string[] = [];
  const poste: PosteRelais = { dossier, secrets, urlPoste, couper: (machine) => void coupees.push(machine) };
  return { registre, acces, secrets, coupees, poste };
}

function appairer(b: Banc, poste: PosteRelais | null, corps: unknown): Promise<Response> | Response {
  const table = routesAppairage(b.acces, journal, poste) as unknown as Record<string, Record<string, Gestionnaire>>;
  const h = table['/api/appareils/appairer']?.['POST'];
  if (!h) throw new Error('route absente');
  const req = new Request('http://relais.test/api/appareils/appairer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  return h(Object.assign(req, { params: {} }), serveur);
}

function codeNeuf(b: Banc): string {
  return b.acces.creerCodeAppairage('essai').code;
}

describe('appairage sans machine : comportement d’origine', () => {
  test('rend seulement la clé d’appareil', async () => {
    const b = banc();
    const code = codeNeuf(b);
    const r = await appairer(b, b.poste, { code, nom: 'iphone' });
    expect(r.status).toBe(200);
    const corps = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(corps)).toEqual(['cle']);
    expect(b.secrets.size).toBe(0);
  });
});

describe('appairage avec machine : la clé et le lien du poste', () => {
  test('rend clé, adresse du lien des postes et secret de la machine', async () => {
    const b = banc();
    const r = await appairer(b, b.poste, { code: codeNeuf(b), nom: 'portable', machine: 'portable' });
    expect(r.status).toBe(200);
    const corps = (await r.json()) as { cle: string; urlPoste: string; jetonPoste: string };
    expect(corps.cle).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(corps.urlPoste).toBe(URL_POSTE);
    expect(corps.jetonPoste).toMatch(/^[0-9a-f]{64}$/);
    expect(b.secrets.get('portable')).toBe(corps.jetonPoste);
  });

  test('une machine déjà connue reçoit un secret neuf, et sa connexion en cours est coupée', async () => {
    const b = banc();
    b.secrets.set('tour', 'ancien-secret');
    const r = await appairer(b, b.poste, { code: codeNeuf(b), nom: 'tour', machine: 'tour' });
    const corps = (await r.json()) as { jetonPoste: string };
    expect(corps.jetonPoste).not.toBe('ancien-secret');
    expect(b.secrets.get('tour')).toBe(corps.jetonPoste);
    expect(b.coupees).toEqual(['tour']);
  });

  test('code réutilisé : refusé, et le secret de la machine ne change pas', async () => {
    const b = banc();
    const code = codeNeuf(b);
    expect((await appairer(b, b.poste, { code, nom: 'a', machine: 'tour' })).status).toBe(200);
    const apres = b.secrets.get('tour');
    const rejoue = await appairer(b, b.poste, { code, nom: 'b', machine: 'tour' });
    expect(rejoue.status).toBe(401);
    expect(b.secrets.get('tour')).toBe(apres);
    expect(b.coupees).toEqual(['tour']);
  });

  test('code expiré : refusé, aucun secret émis', async () => {
    const b = banc();
    const code = 'ABCD-EFGH';
    b.registre.creerCodeAppairage(empreinteCode(code), new Date(Date.now() - 1000).toISOString(), 'essai');
    expect((await appairer(b, b.poste, { code, nom: 'x', machine: 'tour' })).status).toBe(401);
    expect(b.secrets.has('tour')).toBe(false);
  });

  test('machine invalide : 400, et le code n’est pas consommé', async () => {
    const b = banc();
    const code = codeNeuf(b);
    expect((await appairer(b, b.poste, { code, nom: 'x', machine: 'Tour !' })).status).toBe(400);
    expect(b.secrets.size).toBe(0);
    expect((await appairer(b, b.poste, { code, nom: 'x' })).status).toBe(200);
  });

  test('sans relais de postes (appli locale) : 409, et le code n’est pas consommé', async () => {
    const b = banc();
    const code = codeNeuf(b);
    expect((await appairer(b, null, { code, nom: 'x', machine: 'tour' })).status).toBe(409);
    expect((await appairer(b, b.poste, { code, nom: 'x' })).status).toBe(200);
  });

  test('aucune adresse de lien des postes joignable : 409, et le code n’est pas consommé', async () => {
    const b = banc(null);
    const code = codeNeuf(b);
    expect((await appairer(b, b.poste, { code, nom: 'x', machine: 'tour' })).status).toBe(409);
    expect((await appairer(b, b.poste, { code, nom: 'x' })).status).toBe(200);
  });
});
