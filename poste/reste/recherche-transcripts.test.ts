// Responsabilité : tests de la recherche dans les transcripts du poste, sur des fichiers créés dans un dossier temporaire.
// Chemin grep et repli JS ; seuls les messages de Chris et de Claude comptent (ni résultats d'outils, ni méta).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { rechercherTranscripts, type OptionsRecherche } from './recherche-transcripts.ts';

const journal = pino({ enabled: false });
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const SOUS = 'agent-a1234567';
let racine = '';
let projets = '';

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'recherche-transcripts-'));
  projets = join(racine, 'projects');
});
afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

const cwd = (dossier: string): string =>
  `{"type":"user","cwd":"/projets/${dossier}","gitBranch":"main","isSidechain":false`;
const chris = (texte: string, ts: string): string =>
  `${cwd('x')},"timestamp":"${ts}","message":{"role":"user","content":"${texte}"}}`;
const claude = (texte: string, ts: string): string =>
  `{"type":"assistant","timestamp":"${ts}","message":{"content":[{"type":"text","text":"${texte}"},{"type":"tool_use","name":"Bash","input":{"command":"zebre"}}]}}`;
const resultatOutil = (ts: string): string =>
  `{"type":"user","timestamp":"${ts}","message":{"content":[{"type":"tool_result","content":"zebre dans un outil"}]}}`;

function ecrire(dossier: string, nom: string, lignes: string[], mtime: number): string {
  const d = join(projets, dossier);
  mkdirSync(d, { recursive: true });
  const chemin = join(d, `${nom}.jsonl`);
  writeFileSync(chemin, `${lignes.join('\n')}\n`);
  utimesSync(chemin, mtime, mtime);
  return chemin;
}

function options(extra: Partial<OptionsRecherche> = {}): OptionsRecherche {
  return { racines: [projets], journal, ...extra };
}

const T1 = '2026-11-19T10:00:00.000Z';
const T2 = '2026-11-19T11:00:00.000Z';

function jeuDeTest(): void {
  ecrire(
    '-projets-x',
    A,
    [chris('Le ZEBRE est arrivé', T1), claude('Un zebre, oui', T2), resultatOutil(T2)],
    1_700_000_000,
  );
  ecrire('-projets-x', B, [chris('rien à voir', T1), claude('zebre ailleurs', T1)], 1_700_000_100);
  ecrire('-projets-x', SOUS, [chris('zebre de sous-agent', T1)], 1_700_000_200);
  ecrire(
    '-projets-x',
    'c0000000-0000-4000-8000-000000000003',
    [
      `{"type":"user","cwd":"/projets/x","timestamp":"${T1}","isMeta":true,"message":{"role":"user","content":"zebre meta"}}`,
    ],
    1_700_000_300,
  );
  ecrire(
    '-projets-x',
    'd0000000-0000-4000-8000-000000000004',
    [chris('zebre sans dossier', T1)].map((l) => l.replace('"cwd":"/projets/x",', '')),
    1_700_000_400,
  );
}

describe('recherche dans les transcripts', () => {
  test('trouve les messages de Chris et de Claude, sans les résultats d outils ni les méta', async () => {
    jeuDeTest();
    const { resultats } = await rechercherTranscripts('zebre', 50, options());
    const ids = resultats.map((r) => r.sessionId);
    expect(ids).toContain(A);
    expect(ids).toContain(B);
    expect(ids).not.toContain(SOUS);
    expect(resultats.every((r) => r.extrait.toLowerCase().includes('zebre'))).toBe(true);
    expect(resultats.some((r) => r.extrait.includes('outil'))).toBe(false);
  });

  test('l identifiant est le nom du transcript, le dossier le cwd, le rôle celui de la ligne', async () => {
    jeuDeTest();
    const { resultats } = await rechercherTranscripts('zebre', 50, options());
    const deA = resultats.filter((r) => r.sessionId === A);
    expect(deA.find((r) => r.role === 'chris')).toMatchObject({ dossier: '/projets/x', titre: 'Le ZEBRE est arrivé' });
    expect(deA.find((r) => r.role === 'claude')?.extrait).toContain('Un zebre');
    const occ = deA[0];
    expect(occ?.extrait.slice(occ.debut, occ.debut + occ.longueur).toLowerCase()).toBe('zebre');
  });

  test('plus récent d abord, et au plus trois occurrences par session', async () => {
    const lignes = [1, 2, 3, 4, 5].map((n) => chris(`zebre numéro ${n}`, `2026-11-19T10:0${n}:00.000Z`));
    ecrire('-projets-x', A, lignes, 1_700_000_000);
    const { resultats } = await rechercherTranscripts('zebre', 50, options());
    expect(resultats).toHaveLength(3);
    expect(resultats.map((r) => r.extrait)).toEqual(['zebre numéro 5', 'zebre numéro 4', 'zebre numéro 3']);
  });

  test('coupe à la limite demandée', async () => {
    jeuDeTest();
    expect((await rechercherTranscripts('zebre', 1, options())).resultats).toHaveLength(1);
  });

  test('repli en lecture JS quand grep est absent, mêmes résultats', async () => {
    jeuDeTest();
    const avecGrep = await rechercherTranscripts('zebre', 50, options());
    const sansGrep = await rechercherTranscripts('zebre', 50, options({ grep: join(racine, 'absent-grep') }));
    expect(sansGrep.resultats.map((r) => r.sessionId).sort()).toEqual(
      avecGrep.resultats.map((r) => r.sessionId).sort(),
    );
  });

  test('le texte de la recherche n est jamais interprété par un shell', async () => {
    jeuDeTest();
    const piege = join(racine, 'sentinelle');
    const { resultats } = await rechercherTranscripts(`zebre; touch ${piege}`, 50, options());
    expect(resultats).toEqual([]);
    expect(existsSync(piege)).toBe(false);
  });

  test('une requête commençant par un tiret est cherchée comme texte', async () => {
    ecrire('-projets-x', A, [chris('option --verbose activée', T1)], 1_700_000_000);
    const { resultats } = await rechercherTranscripts('--verbose', 50, options());
    expect(resultats.map((r) => r.sessionId)).toEqual([A]);
  });

  test('un délai nul rend un résultat vide sans erreur', async () => {
    jeuDeTest();
    expect((await rechercherTranscripts('zebre', 50, options({ delaiMs: 0 }))).resultats).toEqual([]);
  });

  test('pas de racine existante, pas de recherche', async () => {
    expect((await rechercherTranscripts('zebre', 50, options({ racines: [join(racine, 'rien')] }))).resultats).toEqual(
      [],
    );
  });
});
