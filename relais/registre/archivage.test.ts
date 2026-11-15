import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { MIGRATIONS, ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const MAJ = '2026-11-15T10:00:00.000Z';

function session(id: string, statut: ResumeSession['statut'], majLe = MAJ): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut,
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: majLe,
    majLe,
  };
}

const journal = pino({ enabled: false });

describe('archivage persisté', () => {
  test('le drapeau archivee est persisté et lu sur la vue, par défaut à false', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a', 'fermee'));
    expect(r.session('a')?.archivee).toBe(false);
    r.definirArchivee('a', true);
    expect(r.session('a')?.archivee).toBe(true);
    r.definirArchivee('a', false);
    expect(r.session('a')?.archivee).toBe(false);
  });

  test('une fiche renvoyée par le poste ne désarchive pas la session', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a', 'fermee'));
    r.definirArchivee('a', true);
    r.enregistrerSession(session('a', 'fermee', '2026-11-15T11:00:00.000Z'));
    expect(r.session('a')?.archivee).toBe(true);
  });

  test('sessions() exclut les archivées par défaut, les inclut avec le filtre', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('vivante', 'attente'));
    r.enregistrerSession(session('rangee', 'fermee'));
    r.definirArchivee('rangee', true);
    expect(r.sessions().map((s) => s.id)).toEqual(['vivante']);
    expect(r.sessions(true).map((s) => s.id).sort()).toEqual(['rangee', 'vivante']);
  });

  test('la migration 4 ajoute le drapeau à une base existante sans le perdre', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archivage-'));
    try {
      const chemin = join(dir, 'relais.db');
      const ancienne = new Database(chemin, { create: true, strict: true });
      ancienne.exec(MIGRATIONS.slice(0, 3).join('\n'));
      ancienne.exec('PRAGMA user_version = 3');
      ancienne.query('INSERT INTO sessions (id, machine, resume, maj_le) VALUES ($i, $m, $r, $u)').run({
        i: 'ancienne',
        m: 'tour',
        r: JSON.stringify(session('ancienne', 'fermee')),
        u: MAJ,
      });
      ancienne.close();
      const base = ouvrirBase(chemin);
      const version = base.query('PRAGMA user_version').get() as { user_version: number };
      expect(version.user_version).toBe(MIGRATIONS.length);
      const r = new Registre(base);
      expect(r.session('ancienne')?.archivee).toBe(false);
      r.definirArchivee('ancienne', true);
      base.close();
      expect(new Registre(ouvrirBase(chemin)).session('ancienne')?.archivee).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function fauxPostes(reponse: ReponsePoste): { postes: Pick<Postes, 'commander'>; appels: string[] } {
  const appels: string[] = [];
  const postes = {
    commander: (machine: string, c: { kind: string }) => {
      appels.push(`${machine}:${c.kind}`);
      return Promise.resolve(reponse);
    },
  };
  return { postes, appels };
}

function requete(id: string, action: string): Request & { params: { id: string; action: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/${action}`, { method: 'POST' }), {
    params: { id, action },
  });
}

describe('actions archiver / desarchiver', () => {
  test('archiver une session vivante la ferme d abord, puis la range', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('vivante', 'attente'));
    const { postes, appels } = fauxPostes({ ok: true });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const rep = await api.action(requete('vivante', 'archiver'));
    expect(rep.status).toBe(200);
    expect(appels).toEqual(['tour:fermer']);
    expect(r.session('vivante')?.archivee).toBe(true);
  });

  test('si la fermeture est refusée, rien n est archivé', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('vivante', 'attente'));
    const { postes } = fauxPostes({ ok: false, erreur: 'tour est hors ligne' });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const rep = await api.action(requete('vivante', 'archiver'));
    expect(rep.status).toBe(409);
    expect(r.session('vivante')?.archivee).toBe(false);
  });

  test('archiver une session déjà fermée ne touche pas au poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('close', 'fermee'));
    const { postes, appels } = fauxPostes({ ok: false, erreur: 'pas appelé' });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.action(requete('close', 'archiver'))).status).toBe(200);
    expect(appels).toEqual([]);
    expect(r.session('close')?.archivee).toBe(true);
  });

  test('desarchiver rend la session visible, sans appel au poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('close', 'fermee'));
    r.definirArchivee('close', true);
    const { postes, appels } = fauxPostes({ ok: false, erreur: 'pas appelé' });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.action(requete('close', 'desarchiver'))).status).toBe(200);
    expect(appels).toEqual([]);
    expect(r.session('close')?.archivee).toBe(false);
  });

  test('session inconnue : 404', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    const { postes } = fauxPostes({ ok: true });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.action(requete('absente', 'archiver'))).status).toBe(404);
  });
});
