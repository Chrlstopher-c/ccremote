import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import {
  analyserTranscript,
  IndexDecouvertes,
  identifiantsTranscripts,
  type OptionsIndex,
  normaliserPont,
} from './decouverte.ts';

const journal = pino({ enabled: false });
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const SOUS = 'agent-a1234567';
let racine = '';

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'decouverte-'));
});
afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

const humain = (texte: string, extra = ''): string =>
  `{"type":"user",${extra}"message":{"role":"user","content":"${texte}"}}`;
const LIGNE_CWD = (cwd: string): string => `{"type":"user","cwd":"${cwd}","gitBranch":"main","isSidechain":false}`;

function ecrire(config: string, dossier: string, id: string, lignes: string[]): string {
  const d = join(config, 'projects', dossier);
  mkdirSync(d, { recursive: true });
  const chemin = join(d, `${id}.jsonl`);
  writeFileSync(chemin, lignes.join('\n') + '\n');
  return chemin;
}

// mtime entier : la comparaison du cache est exacte, un mtime à la nanoseconde ne se restaure pas par utimes.
function fixerMtime(chemin: string): void {
  utimesSync(chemin, 1_700_000_000, 1_700_000_000);
}

function index(config: string, cache: string, surChangement = (): void => {}): IndexDecouvertes {
  const options: OptionsIndex = {
    machine: 'tour',
    configDirs: () => [config],
    fichierCache: cache,
    journal,
    surChangement,
  };
  return new IndexDecouvertes(options);
}

describe('analyse d un transcript', () => {
  test('lit le dossier, la branche, le titre et compte les messages', () => {
    const lignes = [LIGNE_CWD('/travail/projet'), humain('Bonjour le monde'), '{"type":"assistant"}'];
    const a = analyserTranscript(lignes.join('\n'));
    expect(a).toMatchObject({
      cwd: '/travail/projet',
      branche: 'main',
      messages: 3,
      sousAgent: false,
      aMessageDeChris: true,
    });
  });

  test('une ligne tronquée ne casse pas l analyse', () => {
    const a = analyserTranscript([LIGNE_CWD('/x'), '{"type":"us', humain('Ok')].join('\n'));
    expect(a.cwd).toBe('/x');
    expect(a.aMessageDeChris).toBe(true);
  });
});

describe('index des sessions découvertes', () => {
  test('liste un transcript nouveau avec son titre tiré du premier message', () => {
    const config = join(racine, 'config');
    ecrire(config, '-travail-projet', A, [LIGNE_CWD('/travail/projet'), humain('Refonte du tableau')]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    expect(idx.liste(() => false)).toMatchObject([
      { id: A, machine: 'tour', cwd: '/travail/projet', titre: 'Refonte du tableau', branche: 'main', messages: 2 },
    ]);
  });

  test('un même identifiant dans deux dossiers (copie ssh-) n apparaît qu une fois', () => {
    const config = join(racine, 'config');
    ecrire(config, '-home-trinity', A, [LIGNE_CWD('/p'), humain('original')]);
    ecrire(config, 'ssh-' + A.slice(0, 8), A, [LIGNE_CWD('/p'), humain('copie')]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    expect(idx.liste(() => false).map((t) => t.id)).toEqual([A]);
  });

  test('un renommage (custom-title) l emporte sur le premier message', () => {
    const config = join(racine, 'config');
    ecrire(config, '-travail-projet', A, [
      LIGNE_CWD('/travail/projet'),
      humain('premier'),
      '{"type":"custom-title","customTitle":"Mon titre"}',
    ]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    expect(idx.liste(() => false)[0]?.titre).toBe('Mon titre');
  });

  test('écarte vides, sous-agents, sans message de Chris, sans dossier et identifiants connus', () => {
    const config = join(racine, 'config');
    ecrire(config, '-p', B, []);
    ecrire(config, '-p', SOUS, [LIGNE_CWD('/p'), humain('sous-agent')]);
    ecrire(config, '-p', '1111aaaa-0000-4000-8000-000000000003', [
      '{"type":"custom-title","customTitle":"x"}',
      LIGNE_CWD('/p'),
    ]);
    ecrire(config, '-p', '2222aaaa-0000-4000-8000-000000000004', ['{"type":"summary"}']);
    ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('connue')]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    expect(idx.liste(() => false).map((t) => t.id)).toEqual([A]);
    expect(idx.liste((id) => id === A)).toEqual([]);
  });

  test('un fichier inchangé n est pas relu, un fichier modifié l est', () => {
    const config = join(racine, 'config');
    const chemin = ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('AAAA')]);
    const idx = index(config, join(racine, 'cache.json'));
    fixerMtime(chemin);
    expect(idx.rafraichir()).toBe(true);
    writeFileSync(chemin, readFileSync(chemin, 'utf8').replace('AAAA', 'BBBB'));
    fixerMtime(chemin); // même mtime et même taille : le cache doit tenir
    expect(idx.rafraichir()).toBe(false);
    expect(idx.liste(() => false)[0]?.titre).toBe('AAAA');
    writeFileSync(chemin, readFileSync(chemin, 'utf8').replace('BBBB', 'CCCCCC'));
    expect(idx.rafraichir()).toBe(true);
    expect(idx.liste(() => false)[0]?.titre).toBe('CCCCCC');
  });

  test('un transcript supprimé disparaît de l index', () => {
    const config = join(racine, 'config');
    const chemin = ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('x')]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    rmSync(chemin);
    expect(idx.rafraichir()).toBe(true);
    expect(idx.liste(() => false)).toEqual([]);
  });

  test('le cache survit au redémarrage sans relire les transcripts', () => {
    const config = join(racine, 'config');
    const chemin = ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('persistant')]);
    const cache = join(racine, 'cache.json');
    fixerMtime(chemin);
    index(config, cache).rafraichir();
    writeFileSync(chemin, readFileSync(chemin, 'utf8').replace('persistant', 'modifie-00'));
    fixerMtime(chemin);
    const neuf = index(config, cache);
    neuf.demarrer();
    expect(neuf.liste(() => false)[0]?.titre).toBe('persistant');
    neuf.arreter();
  });

  test('un cache d une version précédente est ignoré : chaque transcript est relu une fois', () => {
    const config = join(racine, 'config');
    const chemin = ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('relu')]);
    const cache = join(racine, 'cache.json');
    const etat = statSync(chemin);
    const ancien = { entrees: { [chemin]: { mtime: etat.mtimeMs, taille: etat.size, transcript: null } } };
    writeFileSync(cache, JSON.stringify(ancien));
    const idx = index(config, cache);
    idx.demarrer();
    expect(idx.liste(() => false).map((t) => t.id)).toEqual([A]);
    idx.arreter();
  });

  test('le cache écrit porte sa version de format', () => {
    const config = join(racine, 'config');
    ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('x')]);
    const cache = join(racine, 'cache.json');
    index(config, cache).rafraichir();
    expect(JSON.parse(readFileSync(cache, 'utf8')).version).toBe(3);
  });

  test('une configuration absente ne lève rien', () => {
    const idx = index(join(racine, 'absente'), join(racine, 'cache.json'));
    expect(idx.rafraichir()).toBe(false);
    expect(idx.liste(() => false)).toEqual([]);
  });

  test('la configuration par défaut est marquée comme telle (configDir null)', () => {
    const config = join(racine, 'config');
    ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('x')]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    expect(idx.liste(() => false)[0]?.configDir).toBe(config);
  });
});

describe('sous-agents et identifiants de conversation', () => {
  test('les identifiants de conversation excluent les transcripts de sous-agents', () => {
    const config = join(racine, 'config');
    ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('ok')]);
    ecrire(config, '-p', SOUS, [LIGNE_CWD('/p'), humain('sous-agent')]);
    expect(identifiantsTranscripts([config])).toEqual([A]);
  });
});

describe('ponts Remote Control', () => {
  const PONT = (id: string): string => `{"type":"bridge-session","bridgeSessionId":"${id}"}`;

  test('session_X de Desktop devient cse_X ; le reste est gardé tel quel', () => {
    expect(normaliserPont('session_011HAB')).toBe('cse_011HAB');
    expect(normaliserPont('cse_011HAB')).toBe('cse_011HAB');
  });

  test('une ligne bridge-session du transcript donne le pont de la session', () => {
    const config = join(racine, 'config');
    ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('pont'), PONT('cse_011HAA')]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    expect(idx.liste(() => false)[0]?.ponts).toEqual(['cse_011HAA']);
  });

  test('les ponts de la fiche Desktop sont ajoutés, normalisés et dédoublonnés', () => {
    const config = join(racine, 'config');
    ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('pont'), PONT('cse_011HAA')]);
    const fiche = {
      conversation: A,
      cwd: '/p',
      modele: null,
      mode: null,
      archivee: false,
      titre: null,
      remoteControl: true,
      ponts: ['session_011HBB', 'cse_011HAA'],
      hote: null,
    };
    const idx = new IndexDecouvertes({
      machine: 'tour',
      configDirs: () => [config],
      fichierCache: join(racine, 'cache.json'),
      journal,
      surChangement: (): void => {},
      fichesDesktop: () => new Map([[A, fiche]]),
    });
    idx.rafraichir();
    expect(idx.liste(() => false)[0]?.ponts).toEqual(['cse_011HAA', 'cse_011HBB']);
  });

  test('sans pont, le champ est absent', () => {
    const config = join(racine, 'config');
    ecrire(config, '-p', A, [LIGNE_CWD('/p'), humain('nu')]);
    const idx = index(config, join(racine, 'cache.json'));
    idx.rafraichir();
    expect(idx.liste(() => false)[0]).not.toHaveProperty('ponts');
  });
});

describe('sessions Desktop au premier message balisé (#21)', () => {
  test('une session dont la fiche Desktop existe est découverte même sans message de Chris lisible', () => {
    const config = join(racine, 'cfg');
    const balise = '{"type":"user","message":{"content":"<scheduled-task x>"}}';
    ecrire(config, '-home-x', A, [LIGNE_CWD('/travail/projet'), balise]);
    const fiche = {
      conversation: A,
      cwd: '/travail/projet',
      modele: null,
      mode: null,
      archivee: false,
      titre: 'Tâche planifiée',
      remoteControl: false,
      ponts: [],
      hote: null,
    };
    const idx = new IndexDecouvertes({
      machine: 'tour',
      configDirs: () => [config],
      fichierCache: join(racine, 'cache.json'),
      journal,
      surChangement: (): void => {},
      fichesDesktop: () => new Map([[A, fiche]]),
    });
    idx.rafraichir();
    expect(idx.liste(() => false).map((t) => t.id)).toEqual([A]);
  });

  test('sans fiche Desktop, la balise reste exclue', () => {
    const config = join(racine, 'cfg');
    const balise = '{"type":"user","message":{"content":"<scheduled-task x>"}}';
    ecrire(config, '-home-x', B, [LIGNE_CWD('/travail/projet'), balise]);
    const idx = new IndexDecouvertes({
      machine: 'tour',
      configDirs: () => [config],
      fichierCache: join(racine, 'cache.json'),
      journal,
      surChangement: (): void => {},
      fichesDesktop: () => new Map(),
    });
    idx.rafraichir();
    expect(idx.liste(() => false)).toEqual([]);
  });
});
