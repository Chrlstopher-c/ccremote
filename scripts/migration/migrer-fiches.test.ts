import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from '../../relais/registre/base.ts';
import { Registre } from '../../relais/registre/registre.ts';
import { migrerFiches } from './migration.ts';
import { type OptionsMigration, type OptionsTour, lireOptions } from './options.ts';

const MAJ = '2026-11-18T10:00:00.000Z';
const TOUR: OptionsTour = {
  hote: 'tour.test',
  utilisateur: 'agent',
  port: 2222,
  cle: '/cles/tour',
  description: 'Tour',
};
const JOURNAL = pino({ level: 'silent' });

let dossier = '';
beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'migration-fiches-'));
});
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

function fiche(id: string, machine: string, surcharges: Record<string, unknown> = {}): ResumeSession {
  return ResumeSession.parse({
    id,
    machine,
    projet: { machine, chemin: '/projets/demo', nom: 'demo' },
    cwd: '/projets/demo',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 1000, max: 200000 },
    etapes: 1,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...surcharges,
  });
}

function ecrireSource(chemin: string): void {
  const db = ouvrirBase(chemin);
  // Base source ancienne : sans les index sur le JSON des fiches (migration 18), qui refusent une fiche illisible ;
  // elle peut donc en contenir une (s-brisee), que la migration doit écarter.
  db.exec('DROP INDEX sessions_conversation; DROP INDEX sessions_distant;');
  const sessions = db.query(
    'INSERT INTO sessions (id, machine, resume, maj_le, archivee, epinglee, non_lue)' +
      ' VALUES ($id, $m, $r, $maj, $a, $e, $n)',
  );
  const ajouter = (id: string, machine: string, r: string, a: number, e: number, n: number): void => {
    sessions.run({ id, m: machine, r, maj: MAJ, a, e, n });
  };
  ajouter('s-alpha', 'tour', JSON.stringify(fiche('s-alpha', 'tour', { titre: 'Alpha' })), 0, 1, 0);
  ajouter('s-bravo', 'tour', JSON.stringify(fiche('s-bravo', 'tour', { titre: 'Bravo' })), 1, 0, 0);
  ajouter('s-charlie', 'portable', JSON.stringify(fiche('s-charlie', 'portable', { titre: 'Charlie' })), 0, 0, 1);
  ajouter('s-schema', 'tour', JSON.stringify({ id: 's-schema' }), 0, 0, 0);
  ajouter('s-brisee', 'tour', 'pas du json', 0, 0, 0);
  const evenements = db.query('INSERT INTO evenements (session_id, ts, evt) VALUES ($s, $ts, $e)');
  const ajouterEvt = (s: string, minute: number, evt: unknown): void => {
    evenements.run({ s, ts: `2026-11-18T10:${String(minute).padStart(2, '0')}:00.000Z`, e: JSON.stringify(evt) });
  };
  ajouterEvt('s-alpha', 1, { type: 'message', texte: 'Bonjour', uuid: 'u1' });
  ajouterEvt('s-alpha', 2, { type: 'texte', texte: 'Salut' });
  ajouterEvt('s-alpha', 3, { type: 'tour_fini', uuid: 't1', tour: 'x' });
  ajouterEvt('s-alpha', 4, { type: 'artefact', id: 'a1' });
  ajouterEvt('s-charlie', 5, { type: 'message', texte: 'Charlie', uuid: 'u2' });
  ajouterEvt('s-schema', 6, { type: 'message', texte: 'perdu', uuid: 'u3' });
  db.query("INSERT INTO environnements (machine, dossier, enregistre_le) VALUES ('tour', '/projets/demo', $q)").run({
    q: MAJ,
  });
  db.query(
    `INSERT INTO machines_ssh (id, description, hote, port, utilisateur, cle, dossier, cree_le, maj_le)
    VALUES ('pi', 'Pi', 'pi.test', 22, 'pi', '/cles/pi', '~', $q, $q),
    ('portable', 'Portable', 'portable.test', 22, 'agent', '/cles/portable', '~', $q, $q)`,
  ).run({ q: MAJ });
  db.query("INSERT INTO jetons (empreinte, cree_le, expire_le, appareil) VALUES ('e1', $q, $q, 'web')").run({ q: MAJ });
  db.close();
}

function options(cible: string, surcharges: Partial<OptionsMigration> = {}): OptionsMigration {
  return {
    source: join(dossier, 'source.db'),
    cible,
    machineLocale: 'portable',
    simulation: false,
    tour: TOUR,
    ...surcharges,
  };
}

function compter(chemin: string, sql: string): number {
  const db = new Database(chemin, { readonly: true });
  try {
    return (db.query(sql).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe('migrerFiches', () => {
  test('copie fiches, fil, environnements et machines SSH, sans jetons ni machine locale', () => {
    ecrireSource(join(dossier, 'source.db'));
    const cible = join(dossier, 'cible.db');
    const rapport = migrerFiches(options(cible), JOURNAL);

    expect(rapport.sessions).toEqual({ lus: 5, ajoutes: 3, misesAJour: 0, ignores: 2 });
    expect(rapport.evenements).toEqual({ lus: 5, ajoutes: 5, misesAJour: 0, ignores: 0 });
    expect(rapport.artefacts).toBe(1);
    expect(rapport.environnements).toEqual({ lus: 1, ajoutes: 1, misesAJour: 0, ignores: 0 });
    expect(rapport.machinesSsh.retirees).toBe(0);
    expect(rapport.machinesSsh.ajoutes).toBe(2);

    expect(compter(cible, 'SELECT count(*) AS n FROM jetons')).toBe(0);
    expect(compter(cible, "SELECT count(*) AS n FROM machines_ssh WHERE id = 'portable'")).toBe(0);
    const base = ouvrirBase(cible);
    const relais = new Registre(base).sessions(true);
    base.close();
    expect(relais.map((s) => s.titre).sort()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(relais.find((s) => s.id === 's-alpha')?.epinglee).toBe(true);
    expect(relais.find((s) => s.id === 's-bravo')?.archivee).toBe(true);
    expect(relais.find((s) => s.id === 's-charlie')?.nonLue).toBe(true);
  });

  test('deuxième passage : rien d’ajouté ni mis à jour', () => {
    ecrireSource(join(dossier, 'source.db'));
    const cible = join(dossier, 'cible.db');
    migrerFiches(options(cible), JOURNAL);
    const rapport = migrerFiches(options(cible), JOURNAL);

    expect(rapport.sessions).toEqual({ lus: 5, ajoutes: 0, misesAJour: 0, ignores: 5 });
    expect(rapport.evenements).toEqual({ lus: 5, ajoutes: 0, misesAJour: 0, ignores: 5 });
    expect(rapport.environnements).toEqual({ lus: 1, ajoutes: 0, misesAJour: 0, ignores: 1 });
    expect(rapport.machinesSsh).toEqual({ lus: 2, ajoutes: 0, misesAJour: 0, ignores: 2, retirees: 0 });
    expect(compter(cible, 'SELECT count(*) AS n FROM evenements')).toBe(5);
  });

  test('fiche modifiée à la source : seuls les champs de fiche changent, le fil n’est pas dupliqué', () => {
    const source = join(dossier, 'source.db');
    ecrireSource(source);
    const cible = join(dossier, 'cible.db');
    migrerFiches(options(cible), JOURNAL);
    const db = new Database(source, { strict: true });
    db.query('UPDATE sessions SET resume = $r, epinglee = 0 WHERE id = $id').run({
      id: 's-alpha',
      r: JSON.stringify(fiche('s-alpha', 'tour', { titre: 'Alpha renommée' })),
    });
    db.close();
    const rapport = migrerFiches(options(cible), JOURNAL);

    expect(rapport.sessions.misesAJour).toBe(1);
    expect(rapport.evenements.ajoutes).toBe(0);
    expect(compter(cible, "SELECT epinglee AS n FROM sessions WHERE id = 's-alpha'")).toBe(0);
    expect(compter(cible, 'SELECT count(*) AS n FROM evenements')).toBe(5);
  });

  test('simulation : la cible n’est pas écrite, aucune copie ne reste', () => {
    const source = join(dossier, 'source.db');
    ecrireSource(source);
    const cible = join(dossier, 'cible.db');
    const rapport = migrerFiches(options(cible, { simulation: true }), JOURNAL);

    expect(rapport.simulation).toBe(true);
    expect(rapport.sessions.ajoutes).toBe(3);
    expect(existsSync(cible)).toBe(false);
    expect(readdirSync(dossier).filter((f) => f.includes('simulation'))).toEqual([]);
  });

  test('simulation sur une cible existante : rien d’ajouté dans la vraie cible', () => {
    const source = join(dossier, 'source.db');
    ecrireSource(source);
    const cible = join(dossier, 'cible.db');
    migrerFiches(options(cible), JOURNAL);
    const db = new Database(source, { strict: true });
    db.query("INSERT INTO evenements (session_id, ts, evt) VALUES ('s-alpha', '2026-11-18T11:00:00.000Z', '{}')").run();
    db.close();
    const rapport = migrerFiches(options(cible, { simulation: true }), JOURNAL);

    expect(rapport.evenements.ajoutes).toBe(1);
    expect(compter(cible, 'SELECT count(*) AS n FROM evenements')).toBe(5);
  });

  test('machine tour absente sans options : erreur, rien n’est écrit', () => {
    const source = join(dossier, 'source.db');
    ecrireSource(source);
    const cible = join(dossier, 'cible.db');
    expect(() => migrerFiches(options(cible, { tour: null }), JOURNAL)).toThrow('--tour-hote');
    expect(compter(cible, 'SELECT count(*) AS n FROM sessions')).toBe(0);
  });

  test('machine locale présente dans la cible : retirée', () => {
    const source = join(dossier, 'source.db');
    ecrireSource(source);
    const cible = join(dossier, 'cible.db');
    const base = ouvrirBase(cible);
    base
      .query(
        "INSERT INTO machines_ssh (id, hote, utilisateur, cle, cree_le, maj_le)" +
          " VALUES ('portable', 'x', 'x', 'x', $q, $q)",
      )
      .run({ q: MAJ });
    base.close();
    const rapport = migrerFiches(options(cible), JOURNAL);

    expect(rapport.machinesSsh.retirees).toBe(1);
    expect(compter(cible, "SELECT count(*) AS n FROM machines_ssh WHERE id = 'portable'")).toBe(0);
  });

  test('source plus récente que ce code : refusée sans toucher à la cible', () => {
    const source = join(dossier, 'source.db');
    ecrireSource(source);
    const db = new Database(source, { strict: true });
    db.exec('PRAGMA user_version = 99');
    db.close();
    const cible = join(dossier, 'cible.db');
    expect(() => migrerFiches(options(cible), JOURNAL)).toThrow('schéma 99');
    expect(existsSync(cible)).toBe(false);
  });
});

describe('lireOptions', () => {
  const base = ['--source', '/a/source.db', '--cible', '/b/cible.db', '--machine-locale', 'portable'];

  test('options complètes, tour optionnelle', () => {
    const o = lireOptions([...base, '--simulation', '--tour-hote', 'h', '--tour-utilisateur', 'u', '--tour-cle', 'k']);
    expect(o.simulation).toBe(true);
    expect(o.tour).toEqual({ hote: 'h', utilisateur: 'u', port: 22, cle: 'k', description: 'Tour' });
    expect(lireOptions(base).tour).toBeNull();
  });

  test('refus : option inconnue, valeur manquante, tour incomplète, source = cible', () => {
    expect(() => lireOptions([...base, '--inconnue'])).toThrow('option inconnue');
    expect(() => lireOptions(['--source', '--cible', 'x'])).toThrow('valeur manquante');
    expect(() => lireOptions([...base, '--tour-hote', 'h'])).toThrow('vont ensemble');
    const meme = ['--source', '/x.db', '--cible', '/x.db', '--machine-locale', 'p'];
    expect(() => lireOptions(meme)).toThrow('même fichier');
  });
});
