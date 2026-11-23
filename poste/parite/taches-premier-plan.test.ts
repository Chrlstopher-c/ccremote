// Responsabilité : commandes au premier plan (Bash sans run_in_background) montrées parmi les tâches tant qu'elles
// tournent, comme Claude Desktop ; oubliées une fois finies, gardées si Claude Code les détache en fond.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { oublierEtats, lireEtat } from './lecture.ts';
import { resumeParite } from './resume.ts';
import { assistant, outil, resultatOutil, utilisateur } from './fabrique-transcript.ts';

// Journal muet : seules ses méthodes appelées comptent ici.
const JOURNAL = { warn: () => undefined, debug: () => undefined, error: () => undefined } as unknown as Logger;
const iso = (ms: number): string => new Date(ms).toISOString();
let dossier = '';

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'parite-premier-plan-'));
});

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
  oublierEtats();
});

function ecrire(nom: string, lignes: string[]): string {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, `${lignes.join('\n')}\n`);
  oublierEtats();
  return chemin;
}

async function taches(chemin: string): Promise<Awaited<ReturnType<typeof resumeParite>>['taches']> {
  const etat = lireEtat(chemin, JOURNAL);
  if (!etat) throw new Error('état attendu');
  return (await resumeParite({ cwd: dossier, transcript: chemin, fenetre: 1000, journal: JOURNAL }, etat)).taches;
}

const commande = (id: string): Record<string, unknown> => outil(id, 'Bash', { command: 'make', description: 'Construire' });

describe('commandes au premier plan', () => {
  test('en cours tant que son résultat n’est pas arrivé', async () => {
    const chemin = ecrire('en-cours.jsonl', [assistant(iso(Date.now() - 30_000), [commande('p-1')])]);
    expect(await taches(chemin)).toMatchObject([{ id: 'p-1', genre: 'commande', statut: 'en_cours' }]);
  });

  test('finie : oubliée, jamais comptée parmi les terminées', async () => {
    const debut = Date.now() - 60_000;
    const chemin = ecrire('finie.jsonl', [
      assistant(iso(debut), [commande('p-2')]),
      utilisateur(iso(debut + 5000), [resultatOutil('p-2', 'ok')]),
    ]);
    expect(await taches(chemin)).toEqual([]);
  });

  test('détachée en fond par Claude Code : elle reste une tâche', async () => {
    const debut = Date.now() - 60_000;
    const chemin = ecrire('detachee.jsonl', [
      assistant(iso(debut), [commande('p-3')]),
      utilisateur(iso(debut + 5000), [resultatOutil('p-3', 'Command running in background with ID: bg-9.')], {
        backgroundTaskId: 'bg-9',
      }),
    ]);
    expect(await taches(chemin)).toMatchObject([{ id: 'p-3', statut: 'en_cours', tacheId: 'bg-9' }]);
  });
});
