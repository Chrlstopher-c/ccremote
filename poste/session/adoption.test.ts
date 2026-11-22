import { describe, expect, test } from 'bun:test';
import type { EntreeCc } from './registre-cc.ts';
import { adoptionAutorisee, ficheFermee, identitePane, processusAdoptables, titreDe } from './adoption.ts';
import { SessionsSupprimees } from './suppression.ts';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pino from 'pino';
import { cheminTranscript } from './transcript.ts';
import { type ProcessusClaude, processusClaude } from './processus.ts';
import type { PaneTmux } from './tmux.ts';

const pane = (nom: string, dossier = '/home/x/alpha'): PaneTmux => ({
  nom,
  creeLe: 0,
  attachee: false,
  dossier,
  titre: 'titre du pane',
  pid: 4242,
});

const entree: EntreeCc = {
  id: '11111111-aaaa-4bbb-8ccc-222222222222',
  nom: 'Mon projet',
  cwd: '/home/x/alpha',
  tmux: 'claude-alpha',
  lanceur: 'quart',
  creeLe: '2026-10-12T09:00:00Z',
};

const proc: ProcessusClaude = {
  pid: 4242,
  sessionId: '33333333-aaaa-4bbb-8ccc-444444444444',
  cwd: '/home/x/alpha',
  enTmux: true,
  configDir: null,
  nom: 'Nom natif',
};

describe('identitePane', () => {
  test('pane sans identifiant réel : pas de session adoptée (aucun faux id)', () => {
    expect(identitePane(pane('claude-alpha'), [pane('claude-alpha')], undefined, undefined)).toBeNull();
  });

  test('la fiche cc fournit id, nom et lanceur', () => {
    const a = identitePane(pane('claude-alpha'), [pane('claude-alpha')], undefined, entree);
    expect(a?.id).toBe(entree.id);
    expect(a?.nom).toBe('Mon projet');
    expect(a?.lanceur).toBe('quart');
    expect(a?.transcript?.chemin).toMatch(/\/projects\/-home-x-alpha\/11111111.*\.jsonl$/);
  });

  test('le processus déclaré prime sur la fiche pour l id ; le nom reste celui du registre cc', () => {
    const a = identitePane(pane('claude-alpha'), [], proc, entree);
    expect(a?.id).toBe(proc.sessionId);
    expect(a?.nom).toBe('Mon projet');
  });

  test('sans fiche cc, le nom natif de Claude sert de nom', () => {
    const a = identitePane(pane('claude-alpha'), [], proc, undefined);
    expect(a?.nom).toBe('Nom natif');
    expect(a?.lanceur).toBeNull();
  });
});

describe('titreDe', () => {
  test('nom du registre, puis titre du pane, puis dossier', () => {
    expect(titreDe('Mon projet', 'titre du pane', '/home/x/alpha')).toBe('Mon projet');
    expect(titreDe(null, 'titre du pane', '/home/x/alpha')).toBe('titre du pane');
    expect(titreDe(null, null, '/home/x/alpha')).toBe('alpha');
  });
});

describe('ficheFermee', () => {
  test('session cc fermée : statut fermée, reprenable par son id, lanceur conservé', () => {
    const f = ficheFermee({ machine: 'poste', compte: 'principal', fenetre: 200_000 }, entree, 'Titre du transcript');
    expect(f.statut).toBe('fermee');
    expect(f.claudeSessionId).toBe(entree.id);
    expect(f.tmux).toBeNull();
    expect(f.titre).toBe('Titre du transcript');
    expect(f.lanceur).toBe('quart');
  });
});

describe('titre de repli et adoption après suppression', () => {
  test('un nom de tmux suivi d un numéro (« alpha-93 ») n est jamais le titre : le dossier prend sa place', () => {
    expect(titreDe('alpha-93', null, '/home/x/alpha')).toBe('alpha');
    expect(titreDe('racine-2', null, '/home/x/alpha')).toBe('alpha');
  });

  test('un nom donné par Chris reste le titre de repli', () => {
    expect(titreDe('Mon projet', null, '/home/x/alpha')).toBe('Mon projet');
  });

  test('une session supprimée par Chris n est pas réadoptée tant que son identifiant reste retenu', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'adoption-'));
    const supprimees = new SessionsSupprimees(dossier);
    supprimees.ajouter(proc.sessionId);
    expect(adoptionAutorisee(proc.sessionId, supprimees)).toBe(false);
    expect(adoptionAutorisee('autre-session', supprimees)).toBe(true);
  });
});

describe('processusAdoptables : seules les conversations qui ont un transcript', () => {
  const hors = (pid: number, id: string): ProcessusClaude => ({
    pid,
    sessionId: id,
    cwd: '/home/x/alpha',
    enTmux: false,
    configDir: null,
    nom: null,
  });

  test('un processus hors tmux dont le transcript existe est adoptable', () => {
    expect(processusAdoptables([hors(1, 'ok')], () => true).map((p) => p.sessionId)).toEqual(['ok']);
  });

  test('un processus sans transcript n est pas adopté (pas de fiche fantôme)', () => {
    expect(processusAdoptables([hors(2, 'sans-transcript')], () => false)).toEqual([]);
  });

  test('un processus dans tmux reste à son pane, jamais adopté ici', () => {
    const dansTmux = { ...hors(3, 'tmux'), enTmux: true };
    expect(processusAdoptables([dansTmux], () => true)).toEqual([]);
  });
});

describe('registre factice : interactif avec transcript adopté, le reste ignoré', () => {
  test('un -p, un SDK sans transcript et un interactif sans transcript ne sont pas adoptés', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'registre-factice-'));
    try {
      mkdirSync(join(dossier, 'sessions'));
      const decl = (pid: number, id: string, extra: Record<string, string>): void =>
        writeFileSync(
          join(dossier, 'sessions', `${pid}.json`),
          JSON.stringify({ pid, sessionId: id, cwd: '/home/x/alpha', ...extra }),
        );
      decl(3101, 'interactif-ok', { kind: 'interactive', entrypoint: 'cli' });
      decl(3102, 'print-ok', { kind: 'interactive', entrypoint: 'sdk-cli' });
      decl(3103, 'interactif-sans-transcript', { kind: 'interactive', entrypoint: 'cli' });
      for (const id of ['interactif-ok', 'print-ok']) {
        const chemin = cheminTranscript('/home/x/alpha', id, dossier);
        mkdirSync(dirname(chemin), { recursive: true });
        writeFileSync(chemin, '{"type":"user"}\n');
      }
      const vivant = (): { comm: string; exe: string; demarrage: string; enTmux: boolean } => ({
        comm: 'claude', exe: '/usr/bin/claude', demarrage: '1', enTmux: false,
      });
      const procs = processusClaude([dossier], pino({ enabled: false }), vivant);
      const adoptables = processusAdoptables(procs, (p) => existsSync(cheminTranscript(p.cwd, p.sessionId, dossier)));
      expect(adoptables.map((p) => p.sessionId)).toEqual(['interactif-ok']);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
