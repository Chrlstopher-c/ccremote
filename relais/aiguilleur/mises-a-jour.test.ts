import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { nomServable, routeMisesAJour } from './mises-a-jour.ts';

const dossier = mkdtempSync(join(tmpdir(), 'maj-'));
writeFileSync(join(dossier, 'latest.json'), '{"version":"0.2.1"}');
const route = routeMisesAJour({
  dossier,
  journal: pino({ level: 'silent' }),
  membreDuJeton: (j) => (j === 'bon' ? { revoque: false } : j === 'revoque' ? { revoque: true } : null),
});
const demande = (chemin: string, jeton?: string): Request =>
  new Request(`http://x${chemin}`, jeton ? { headers: { authorization: `Bearer ${jeton}` } } : {});

describe('mises à jour servies par l’aiguilleur', () => {
  test('seuls des noms de paquets sont servables', () => {
    expect(nomServable('/maj/latest.json')).toBe('latest.json');
    expect(nomServable('/maj/Noctis_0.2.1_amd64.AppImage')).toBe('Noctis_0.2.1_amd64.AppImage');
    expect(nomServable('/maj/../annuaire.db')).toBeNull();
    expect(nomServable('/maj/.cache')).toBeNull();
  });
  test('un membre lit le manifeste ; sans jeton, faux ou révoqué : 401', async () => {
    expect((await route(demande('/maj/latest.json', 'bon')).text())).toContain('0.2.1');
    expect(route(demande('/maj/latest.json')).status).toBe(401);
    expect(route(demande('/maj/latest.json', 'faux')).status).toBe(401);
    expect(route(demande('/maj/latest.json', 'revoque')).status).toBe(401);
  });
  test('fichier absent : 404', () => {
    expect(route(demande('/maj/absent.AppImage', 'bon')).status).toBe(404);
  });
});
