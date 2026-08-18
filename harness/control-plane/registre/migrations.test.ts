/**
 * Migrations qui RECONSTRUISENT une table : la seule famille où « la migration
 * s'est appliquée » et « les données sont encore là » sont deux faits distincts.
 *
 * `☠` Une écriture acquittée n'est pas une écriture faite : `migrer()` rend une
 * version, pas un décompte de lignes. Une reconstruction dont l'INSERT ... SELECT
 * oublierait une colonne migrerait proprement, en silence, et Chris découvrirait
 * la perte au premier écran qui relit la table.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS, migrer, versionSchema } from './migrations.ts';

let db: Database;

/** Applique le schéma jusqu'à `cible` incluse, comme le ferait un déploiement d'alors. */
function migrerJusqua(cible: number): void {
  for (const m of MIGRATIONS) {
    if (m.version > cible) break;
    db.run(m.sql);
    db.run(`PRAGMA user_version = ${m.version}`);
  }
}

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => db.close());

describe('migration 29 — reconstruction de demande_rallonge', () => {
  test('☠ les demandes existantes SURVIVENT à la reconstruction', () => {
    migrerJusqua(28);
    db.run(
      `INSERT INTO demande_rallonge (id, conversation_id, plafond_demande, motif, statut, cree_a, maj_a, detail)
       VALUES ('r-avant', 'conv-1', '80', 'chantier de 60 équipes', 'en_attente', 1000, 1000, NULL),
              ('r-tranchee', 'conv-2', 'illimite', 'nuit longue', 'accordee', 900, 950, 'accordée')`,
    );

    expect(migrer(db)).toBe(30);

    const lignes = db
      .query<{ id: string; plafond_demande: string | null; motif: string; statut: string; detail: string | null }, []>(
        'SELECT id, plafond_demande, motif, statut, detail FROM demande_rallonge ORDER BY id',
      )
      .all();
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toEqual({
      id: 'r-avant',
      plafond_demande: '80',
      motif: 'chantier de 60 équipes',
      statut: 'en_attente',
      detail: null,
    });
    expect(lignes[1]?.plafond_demande).toBe('illimite');
    expect(lignes[1]?.detail).toBe('accordée');
  });

  test('l’index des demandes en attente est recréé — pas seulement la table', () => {
    migrerJusqua(28);
    migrer(db);
    const index = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'demande_rallonge'")
      .all()
      .map((l) => l.name);
    expect(index).toContain('idx_demande_rallonge_attente');
  });

  test('la table de travail ne survit pas à la migration', () => {
    migrerJusqua(28);
    migrer(db);
    const restes = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name = 'demande_rallonge_v27'")
      .all();
    expect(restes).toHaveLength(0);
  });

  // ☠ Les CHECK sont l'invariant, pas le commentaire qui les décrit. Une demande
  // qui ne demande rien, ou une plage à moitié posée, doivent être refusées PAR
  // LA BASE : c'est le dernier filet quand un appelant futur oublie la garde.
  test('☠ une demande qui ne demande RIEN est refusée par la base', () => {
    migrerJusqua(28);
    migrer(db);
    expect(() =>
      db.run(
        `INSERT INTO demande_rallonge (id, conversation_id, plafond_demande, motif, statut, cree_a, maj_a)
         VALUES ('vide', 'conv-1', NULL, 'motif', 'en_attente', 1, 1)`,
      ),
    ).toThrow();
  });

  test('☠ une plage à moitié posée est refusée par la base', () => {
    migrerJusqua(28);
    migrer(db);
    expect(() =>
      db.run(
        `INSERT INTO demande_rallonge
           (id, conversation_id, plafond_demande, fenetre_debut, fenetre_fin, motif, statut, cree_a, maj_a)
         VALUES ('demi', 'conv-1', NULL, 1000, NULL, 'motif', 'en_attente', 1, 1)`,
      ),
    ).toThrow();
  });

  test('☠ une plage qui se termine avant de commencer est refusée par la base', () => {
    migrerJusqua(28);
    migrer(db);
    expect(() =>
      db.run(
        `INSERT INTO demande_rallonge
           (id, conversation_id, plafond_demande, fenetre_debut, fenetre_fin, motif, statut, cree_a, maj_a)
         VALUES ('inverse', 'conv-1', NULL, 2000, 1000, 'motif', 'en_attente', 1, 1)`,
      ),
    ).toThrow();
  });

});

describe('migration 30 — reconstruction de conversation_evenement (type artefact)', () => {
  test('☠ un évènement existant, avec toutes ses colonnes, SURVIT à la reconstruction', () => {
    migrerJusqua(29);
    db.run(`INSERT INTO conversation (id, titre, session_id, statut, cree_a, maj_a) VALUES ('c1', 'Fil', NULL, 'active', 1, 1)`);
    db.run(
      `INSERT INTO conversation_evenement
         (conversation_id, type, contenu, cree_a, modele, effort, tool_use_id, detail, resultat, pieces)
       VALUES ('c1', 'outil', 'lister_equipes', 1000, 'sonnet', 'high', 'tu-1', '{"etat":"actives"}', '{"ok":true}', NULL)`,
    );

    expect(migrer(db)).toBe(30);

    const ligne = db
      .query<
        { type: string; contenu: string; modele: string | null; tool_use_id: string | null; resultat: string | null },
        [string]
      >('SELECT type, contenu, modele, tool_use_id, resultat FROM conversation_evenement WHERE conversation_id = ?')
      .get('c1');
    expect(ligne).toEqual({
      type: 'outil',
      contenu: 'lister_equipes',
      modele: 'sonnet',
      tool_use_id: 'tu-1',
      resultat: '{"ok":true}',
    });
  });

  test('un évènement de type « artefact » est désormais accepté par la base', () => {
    migrerJusqua(29);
    migrer(db);
    db.run(`INSERT INTO conversation (id, titre, session_id, statut, cree_a, maj_a) VALUES ('c1', 'Fil', NULL, 'active', 1, 1)`);
    expect(() =>
      db.run(
        `INSERT INTO conversation_evenement (conversation_id, type, contenu, cree_a, pieces)
         VALUES ('c1', 'artefact', 'demo.html', 1000, '[{"fichier":"f.html","nom":"demo.html","type":"text/html","taille":10}]')`,
      ),
    ).not.toThrow();
  });

  test('☠ un type hors liste reste refusé par la base après la migration', () => {
    migrerJusqua(29);
    migrer(db);
    db.run(`INSERT INTO conversation (id, titre, session_id, statut, cree_a, maj_a) VALUES ('c1', 'Fil', NULL, 'active', 1, 1)`);
    expect(() =>
      db.run(`INSERT INTO conversation_evenement (conversation_id, type, contenu, cree_a) VALUES ('c1', 'fantome', 'x', 1000)`),
    ).toThrow();
  });

  test('les deux index sont recréés, la table de travail ne survit pas', () => {
    migrerJusqua(29);
    migrer(db);
    const index = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'conversation_evenement'")
      .all()
      .map((l) => l.name);
    expect(index).toContain('idx_conv_evt');
    expect(index).toContain('idx_conv_evt_tool');
    const restes = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name = 'conversation_evenement_v30'")
      .all();
    expect(restes).toHaveLength(0);
  });

  test('une migration complète depuis zéro atteint la même version', () => {
    expect(migrer(db)).toBe(30);
    expect(versionSchema(db)).toBe(30);
  });
});
