import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routesHq } from './hq.ts';
import { indexSpa, servirStatique } from './statique.ts';

const racine = mkdtempSync(join(tmpdir(), 'hq-dist-'));

beforeAll(() => {
  mkdirSync(join(racine, 'assets'));
  writeFileSync(join(racine, 'index.html'), '<!doctype html><title>HQ</title>');
  writeFileSync(join(racine, 'assets', 'app-1.js'), 'console.log(1)');
});

afterAll(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe('service statique', () => {
  test('fichier exact servi avec le bon type et cache immuable pour /assets/', () => {
    const r = servirStatique(racine, '/assets/app-1.js');
    expect(r).not.toBeNull();
    expect(r?.headers.get('cache-control')).toContain('immutable');
  });

  test('fichier absent : null ; index.html via indexSpa', async () => {
    expect(servirStatique(racine, '/route/inconnue')).toBeNull();
    expect(await indexSpa(racine).text()).toContain('<title>HQ</title>');
  });

  test('chemin qui sort de la racine : jamais servi', () => {
    expect(servirStatique(racine, '/../../etc/passwd')).toBeNull();
    expect(servirStatique(racine, '/assets/../../secret')).toBeNull();
  });

  test('pourcentage mal formé : null, sans lever d erreur', () => {
    expect(servirStatique(racine, '/%E0%A4%A')).toBeNull();
  });
});

describe('routes /hq/', () => {
  const ouvert = routesHq(racine, () => true);
  const refuse = routesHq(racine, () => false);
  const appeler = (
    table: ReturnType<typeof routesHq>,
    chemin: string,
  ): Promise<Response> | Response => {
    const handler = table[chemin];
    if (!handler) throw new Error(`pas de route ${chemin}`);
    return handler(new Request(`http://relais.test${chemin}`));
  };

  test('/hq/ et /hq/<route SPA> : index.html en repli', async () => {
    const handler = ouvert['/hq/*'];
    if (!handler) throw new Error('route /hq/* absente');
    const r = await handler(new Request('http://relais.test/hq/une/route'));
    expect(await r.text()).toContain('<title>HQ</title>');
  });

  test('refus sans authentification : 401 sur toute la sous-arborescence', async () => {
    const handler = refuse['/hq/*'];
    if (!handler) throw new Error('route /hq/* absente');
    expect((await handler(new Request('http://relais.test/hq/une/route'))).status).toBe(401);
    expect((await appeler(refuse, '/hq')).status).toBe(401);
  });
});
