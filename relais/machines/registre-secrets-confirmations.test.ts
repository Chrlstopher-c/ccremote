import { describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirBase } from '../registre/base.ts';
import { Confirmations } from './confirmations.ts';
import { RegistreMachines } from './registre-machines.ts';
import { chargerSecretsPostes, retirerSecretPoste, secretPoste } from './secrets.ts';

const CONFIG = {
  id: 'vps-test',
  description: 'Essai',
  hote: 'machine.exemple.test',
  port: 22,
  utilisateur: 'utilisateur',
  cle: '/k/cle',
  dossier: '~',
};

describe('registre des machines', () => {
  test('insérer, lire, modifier partiellement, supprimer', () => {
    const r = new RegistreMachines(ouvrirBase(':memory:'));
    r.inserer(CONFIG, 47321, '2026-11-19T00:00:00.000Z');
    expect(r.lire('vps-test')?.hote).toBe('machine.exemple.test');
    expect(r.modifier('vps-test', { dossier: '~/dev' }, '2026-11-19T01:00:00.000Z')).toBe(true);
    const lue = r.lire('vps-test');
    expect(lue?.dossier).toBe('~/dev');
    expect(lue?.description).toBe('Essai');
    expect(lue?.cree_le).toBe('2026-11-19T00:00:00.000Z');
    expect(lue?.maj_le).toBe('2026-11-19T01:00:00.000Z');
    expect(r.supprimer('vps-test')).toBe(true);
    expect(r.lire('vps-test')).toBeNull();
    expect(r.modifier('absente', {}, 'x')).toBe(false);
  });
});

describe('secrets des postes', () => {
  test('création en 600, relecture, retrait', () => {
    const dossier = join(mkdtempSync(join(tmpdir(), 'secrets-test-')), 'postes');
    const secrets = new Map<string, string>();
    const s = secretPoste(dossier, 'vps-test', secrets);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dossier, 'vps-test.secret')).mode & 0o777).toBe(0o600);
    expect(secretPoste(dossier, 'vps-test', secrets)).toBe(s);
    expect(chargerSecretsPostes(dossier).get('vps-test')).toBe(s);
    retirerSecretPoste(dossier, 'vps-test', secrets);
    expect(secrets.has('vps-test')).toBe(false);
    expect(chargerSecretsPostes(dossier).size).toBe(0);
  });
});

describe('confirmations', () => {
  const diffusees: unknown[] = [];
  const nouvelle = (delai?: number) => new Confirmations((m) => diffusees.push(m), delai);

  test('accord : accordee, diffusée, réponse unique', async () => {
    const c = nouvelle();
    const d = c.demander({ action: 'supprimer_machine', cible: 'vps-test', resume: 'Supprimer vps-test' });
    expect(d.statut).toBe('en_attente');
    const pendant = c.attendre(d.id, 50);
    expect(c.repondre(d.id, true).ok).toBe(true);
    expect((await pendant)?.statut).toBe('accordee');
    expect(c.repondre(d.id, false).ok).toBe(false);
    expect(diffusees.length).toBeGreaterThanOrEqual(2);
  });

  test('refus : refusee, rien d’autre', () => {
    const c = nouvelle();
    const d = c.demander({ action: 'modifier_machine', cible: 'x', resume: 'r' });
    c.repondre(d.id, false);
    expect(c.lire(d.id)?.statut).toBe('refusee');
  });

  test('sans réponse dans le délai : expiree (compte comme refus)', async () => {
    const c = nouvelle(1);
    const d = c.demander({ action: 'supprimer_machine', cible: 'x', resume: 'r' });
    await Bun.sleep(5);
    expect((await c.attendre(d.id, 10))?.statut).toBe('expiree');
  });

  test('identifiant inconnu', () => {
    expect(nouvelle().lire('absente')).toBeNull();
    expect(nouvelle().repondre('absente', true).ok).toBe(false);
  });
});
