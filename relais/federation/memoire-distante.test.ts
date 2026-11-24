// Responsabilité : les sessions d'un nœud apparié restent visibles après un redémarrage de ce nœud-ci, même si le
// nœud apparié est éteint (dernière liste gardée sur disque).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { CacheDistant } from './distant.ts';
import { MemoireDistante } from './memoire-distante.ts';

const journal = pino({ level: 'silent' });
// Fiche minimale : seuls l'identifiant et la machine comptent ici.
const fiche = (id: string): ResumeSession => ({ id, machine: 'tour' }) as unknown as ResumeSession;

describe('sessions des nœuds appariés gardées sur disque', () => {
  test('après redémarrage, la tour éteinte montre encore ses sessions', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'memoire-distante-'));
    const chemin = join(dossier, 'sessions-distantes.json');
    try {
      const avant = new MemoireDistante(chemin, journal, 10_000);
      const cache = new CacheDistant(avant);
      cache.connaitre('m-tour', 'Tour');
      cache.instantane('m-tour', 'tour', 'Tour', [fiche('s1'), fiche('s2')]);
      avant.vider();
      expect(statSync(chemin).mode & 0o777).toBe(0o600);

      const apres = new CacheDistant(new MemoireDistante(chemin, journal, 10_000));
      apres.connaitre('m-tour', 'Tour');
      const [noeud] = apres.noeudsConnus();
      expect(noeud?.enLigne).toBe(false);
      expect(noeud?.machine).toBe('tour');
      expect(noeud?.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('un nœud révoqué disparaît aussi du disque', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'memoire-distante-'));
    const chemin = join(dossier, 'sessions-distantes.json');
    try {
      const memoire = new MemoireDistante(chemin, journal, 10_000);
      const cache = new CacheDistant(memoire);
      cache.instantane('m-tour', 'tour', 'Tour', [fiche('s1')]);
      cache.retirer('m-tour');
      memoire.vider();
      const apres = new CacheDistant(new MemoireDistante(chemin, journal, 10_000));
      apres.connaitre('m-tour', 'Tour');
      expect(apres.noeudsConnus()[0]?.sessions).toEqual([]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('fichier illisible : liste vide, sans planter', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'memoire-distante-'));
    try {
      const chemin = join(dossier, 'x.json');
      Bun.write(chemin, '{pas du json');
      expect(new MemoireDistante(chemin, journal).noeud('m')).toBeNull();
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
